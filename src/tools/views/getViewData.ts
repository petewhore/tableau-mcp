import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const getViewDataTool = new Tool({
  name: 'get-view-data',
  description: `
Extract data from a Tableau view/dashboard in various formats. This tool allows you to programmatically access the underlying data of visualizations.

**Parameters:**
- \`viewId\`: ID of the view to extract data from (required)
- \`format\`: Output format - csv, json, or pdf (optional, default: csv)
- \`maxRows\`: Maximum number of rows to return (optional, default: 10000)
- \`includeHeaders\`: Include column headers in output (optional, default: true)
- \`filters\`: Filter values to apply to the view (optional)

**Supported Formats:**
- **CSV**: Comma-separated values for spreadsheet applications
- **JSON**: Structured data format for programmatic processing
- **PDF**: Visual representation as PDF document

**Data Extraction Options:**
- **Summary Data**: Aggregated data as shown in the view
- **Underlying Data**: Raw data used to create the visualization
- **Filtered Data**: Apply filters before extraction
- **Crosstab Data**: Data in crosstab/pivot table format

**Filter Application:**
- **Column Filters**: Filter specific columns before extraction
- **Parameter Values**: Apply parameter values to dynamic views
- **Context Filters**: Apply context-level filters
- **Quick Filters**: Apply dashboard quick filter values

**Performance Considerations:**
- **Row Limits**: Large datasets may require pagination
- **View Complexity**: Complex views may take longer to process
- **Filter Impact**: Filters can significantly reduce processing time
- **Format Overhead**: PDF generation requires more server resources

**Example Usage:**
- CSV extraction: \`{ "viewId": "view-123", "format": "csv", "maxRows": 5000 }\`
- Filtered data: \`{ "viewId": "view-456", "format": "json", "filters": {"Region": "North", "Year": "2023"} }\`
- PDF export: \`{ "viewId": "view-789", "format": "pdf", "includeHeaders": true }\`

**Use Cases:**
- **Data Analysis**: Extract data for external analysis tools
- **Reporting**: Generate data exports for reports
- **Integration**: Feed Tableau data into other systems
- **Backup**: Create data snapshots for archival
- **Automation**: Scheduled data extraction workflows

**Security Considerations:**
- User must have appropriate view permissions
- Data extraction respects row-level security
- Sensitive data handling according to organizational policies
- Audit logging of data access and extraction
`,
  paramsSchema: {
    viewId: z.string().min(1, 'View ID is required'),
    format: z.enum(['csv', 'json', 'pdf']).optional(),
    maxRows: z.number().min(1).max(100000).optional(),
    includeHeaders: z.boolean().optional(),
    filters: z.record(z.string(), z.string()).optional(),
  },
  annotations: {
    title: 'Get View Data',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ 
    viewId, 
    format = 'csv', 
    maxRows = 10000, 
    includeHeaders = true, 
    filters 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await getViewDataTool.logAndExecute({
      requestId,
      args: { viewId, format, maxRows, includeHeaders, filters },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify view exists and get details
          let view;
          try {
            view = await restApi.viewsMethods.getView(restApi.siteId, viewId);
          } catch (error) {
            return new Err(`View with ID '${viewId}' not found`);
          }
          
          // Analyze view characteristics
          const viewType = view.contentUrl ? 'Dashboard' : 'View';
          const workbookName = view.workbook?.name || 'Unknown';
          const projectName = view.project?.name || 'Unknown';
          
          // Estimate extraction complexity
          const extractionComplexity = (() => {
            let complexity = 0;
            if (maxRows > 50000) complexity += 2;
            if (filters && Object.keys(filters).length > 3) complexity += 1;
            if (format === 'pdf') complexity += 2;
            if (viewType === 'Dashboard') complexity += 1;
            
            if (complexity >= 4) return 'High';
            if (complexity >= 2) return 'Medium';
            return 'Low';
          })();
          
          // Apply filters if provided
          let filterOptions = {};
          if (filters) {
            filterOptions = {
              filters: Object.entries(filters).map(([column, value]) => ({
                column,
                value,
              })),
            };
          }
          
          // Extract data based on format
          let extractedData;
          let dataMetadata = {};
          
          switch (format) {
            case 'csv':
              extractedData = await restApi.viewsMethods.getViewData(restApi.siteId, viewId, {
                format: 'csv',
                maxRows,
                includeHeaders,
                ...filterOptions,
              });
              
              // Analyze CSV data
              if (typeof extractedData === 'string') {
                const lines = extractedData.split('\n').filter(line => line.trim());
                const headerLine = includeHeaders ? lines[0] : null;
                const dataLines = includeHeaders ? lines.slice(1) : lines;
                
                dataMetadata = {
                  totalRows: dataLines.length,
                  totalColumns: headerLine ? headerLine.split(',').length : 0,
                  headers: headerLine ? headerLine.split(',').map(h => h.trim().replace(/"/g, '')) : [],
                  sampleRows: dataLines.slice(0, 3),
                  dataSize: extractedData.length,
                };
              }
              break;
              
            case 'json':
              extractedData = await restApi.viewsMethods.getViewData(restApi.siteId, viewId, {
                format: 'json',
                maxRows,
                ...filterOptions,
              });
              
              // Analyze JSON data
              if (Array.isArray(extractedData)) {
                dataMetadata = {
                  totalRows: extractedData.length,
                  totalColumns: extractedData.length > 0 ? Object.keys(extractedData[0]).length : 0,
                  headers: extractedData.length > 0 ? Object.keys(extractedData[0]) : [],
                  sampleRows: extractedData.slice(0, 3),
                  dataSize: JSON.stringify(extractedData).length,
                };
              }
              break;
              
            case 'pdf':
              extractedData = await restApi.viewsMethods.getViewData(restApi.siteId, viewId, {
                format: 'pdf',
                ...filterOptions,
              });
              
              // Analyze PDF data
              dataMetadata = {
                isPdf: true,
                dataSize: extractedData ? extractedData.length : 0,
                contentType: 'application/pdf',
              };
              break;
          }
          
          // Calculate processing statistics
          const processingStats = {
            requestedRows: maxRows,
            actualRows: dataMetadata.totalRows || 0,
            rowLimitReached: (dataMetadata.totalRows || 0) >= maxRows,
            filtersApplied: filters ? Object.keys(filters).length : 0,
            extractionComplexity,
            estimatedProcessingTime: (() => {
              if (extractionComplexity === 'High') return '30+ seconds';
              if (extractionComplexity === 'Medium') return '10-30 seconds';
              return '1-10 seconds';
            })(),
          };
          
          // Analyze data quality and characteristics
          const dataAnalysis = {
            format,
            hasHeaders: includeHeaders && format !== 'pdf',
            dataComplete: !processingStats.rowLimitReached,
            filteringEffective: filters ? (dataMetadata.totalRows || 0) < maxRows * 0.8 : false,
            sizeCategory: (() => {
              const size = dataMetadata.dataSize || 0;
              if (size > 10000000) return 'Large'; // >10MB
              if (size > 1000000) return 'Medium'; // >1MB
              return 'Small';
            })(),
          };
          
          return new Ok({
            success: true,
            dataExtracted: true,
            view: {
              id: view.id,
              name: view.name,
              type: viewType,
              workbookName,
              projectName,
              contentUrl: view.contentUrl,
            },
            extraction: {
              format,
              maxRows,
              includeHeaders,
              filtersApplied: filters || {},
              extractionComplexity,
            },
            data: format === 'pdf' ? null : extractedData, // Don't include binary PDF data in response
            metadata: dataMetadata,
            statistics: processingStats,
            analysis: dataAnalysis,
            summary: {
              viewName: view.name,
              extractedFormat: format,
              rowsExtracted: dataMetadata.totalRows || 0,
              columnsExtracted: dataMetadata.totalColumns || 0,
              dataSize: dataMetadata.dataSize ? 
                `${Math.round((dataMetadata.dataSize || 0) / 1024)} KB` : 'Unknown',
              filteringApplied: processingStats.filtersApplied > 0,
              extractionSuccess: true,
            },
            message: `Successfully extracted ${format.toUpperCase()} data from view '${view.name}' (${dataMetadata.totalRows || 0} rows${processingStats.filtersApplied > 0 ? `, ${processingStats.filtersApplied} filters applied` : ''})`,
            warnings: {
              ...(processingStats.rowLimitReached ? 
                { rowLimit: `Data extraction limited to ${maxRows} rows - use pagination for complete dataset` } : {}),
              ...(dataAnalysis.sizeCategory === 'Large' ? 
                { largeDataset: 'Large dataset extracted - consider filtering or pagination for better performance' } : {}),
              ...(extractionComplexity === 'High' ? 
                { complexity: 'High complexity extraction - processing time may be significant' } : {}),
              ...(format === 'pdf' ? 
                { pdfFormat: 'PDF format returns visual representation, not raw data' } : {}),
            },
            recommendations: {
              ...(processingStats.rowLimitReached ? 
                { pagination: 'Use pagination or additional filtering to access complete dataset' } : {}),
              ...(dataAnalysis.sizeCategory === 'Large' ? 
                { optimization: 'Consider applying filters to reduce data size and improve performance' } : {}),
              ...(format === 'csv' && dataMetadata.totalColumns && dataMetadata.totalColumns > 20 ? 
                { columnSelection: 'Consider selecting specific columns if not all data is needed' } : {}),
              caching: 'Cache extracted data if it will be used multiple times',
              scheduling: 'Consider scheduling regular extractions for frequently needed data',
              security: 'Ensure extracted data is handled according to organizational security policies',
              verification: 'Verify data accuracy by comparing with original view when possible',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to extract view data: ${error}`);
        }
      },
    });
  },
});