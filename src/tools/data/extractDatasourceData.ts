import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const extractDatasourceDataTool = new Tool({
  name: 'extract-datasource-data',
  description: `
Extract bulk data from Tableau data sources using the VizQL Data Service API. Optimized for large data extractions with configurable options for performance and format.

**Parameters:**
- \`datasourceLuid\`: Data source ID to extract from (required)
- \`maxRows\`: Maximum number of rows to extract (default: 10000, max: 100000)
- \`includeMetadata\`: Include field metadata in response (default: true)
- \`format\`: Output format preference (default: 'json')
- \`timeout\`: Query timeout in milliseconds (default: 30000, max: 300000)

**Extraction Options:**
- **Small extracts** (< 1K rows): Fast response, suitable for sampling
- **Medium extracts** (1K - 10K rows): Good for analysis and reporting
- **Large extracts** (10K+ rows): Use higher timeout, consider pagination

**Format Options:**
- \`json\`: Structured JSON format (default)
- \`csv\`: Comma-separated values (planned)

**Performance Considerations:**
- Larger datasets may require longer timeout values
- Consider using filters via query-datasource tool for targeted extraction
- Monitor memory usage with very large datasets
- Use pagination for datasets over 100K rows

**Metadata Information:**
- Field names and data types
- Field roles (dimension/measure)
- Data source connection details
- Extraction timestamp and performance metrics

**Example Usage:**
- Basic extraction: \`{ "datasourceLuid": "ds-123" }\`
- Large dataset: \`{ "datasourceLuid": "ds-123", "maxRows": 50000, "timeout": 120000 }\`
- Quick sample: \`{ "datasourceLuid": "ds-123", "maxRows": 100 }\`
- Metadata only: \`{ "datasourceLuid": "ds-123", "maxRows": 0, "includeMetadata": true }\`

**Return Information:**
- Complete dataset within row limits
- Field metadata and data types
- Performance metrics and timing
- Data quality indicators
- Extraction summary statistics

**Use Cases:**
- Data analysis and exploration
- Report generation
- Data quality assessment
- Backup and archival
- Integration with external systems
`,
  paramsSchema: {
    datasourceLuid: z.string().min(1, 'Data source LUID is required'),
    maxRows: z.number().int().min(0).max(100000).default(10000),
    includeMetadata: z.boolean().default(true),
    format: z.enum(['json', 'csv']).default('json'),
    timeout: z.number().int().min(5000).max(300000).default(30000),
  },
  annotations: {
    title: 'Extract Datasource Data',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ 
    datasourceLuid, 
    maxRows, 
    includeMetadata, 
    format, 
    timeout 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await extractDatasourceDataTool.logAndExecute({
      requestId,
      args: { datasourceLuid, maxRows, includeMetadata, format, timeout },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          const startTime = Date.now();
          
          const result = await restApi.vizqlDataServiceApi.extractDatasourceData(
            datasourceLuid,
            {
              maxRows,
              includeMetadata,
              format,
              timeout,
            }
          );
          
          const executionTime = Date.now() - startTime;
          
          // Analyze extracted data
          const dataAnalysis = {
            rowCount: result.rowCount,
            columnCount: result.data.length > 0 ? Object.keys(result.data[0]).length : 0,
            dataTypes: includeMetadata ? result.metadata.fields.reduce((acc, field) => {
              acc[field.dataType] = (acc[field.dataType] || 0) + 1;
              return acc;
            }, {} as Record<string, number>) : {},
            fieldRoles: includeMetadata ? result.metadata.fields.reduce((acc, field) => {
              acc[field.role] = (acc[field.role] || 0) + 1;
              return acc;
            }, {} as Record<string, number>) : {},
            sampleValues: result.data.slice(0, 3), // First 3 rows as sample
            nullCounts: result.data.length > 0 ? Object.keys(result.data[0]).reduce((acc, key) => {
              acc[key] = result.data.filter(row => row[key] === null || row[key] === undefined).length;
              return acc;
            }, {} as Record<string, number>) : {},
          };
          
          // Calculate data quality metrics
          const dataQuality = {
            completeness: dataAnalysis.columnCount > 0 ? 
              Object.values(dataAnalysis.nullCounts).reduce((sum, nulls) => sum + nulls, 0) / 
              (dataAnalysis.columnCount * result.rowCount) : 0,
            uniqueness: result.data.length > 0 ? Object.keys(result.data[0]).reduce((acc, key) => {
              const uniqueValues = new Set(result.data.map(row => row[key]));
              acc[key] = uniqueValues.size / result.rowCount;
              return acc;
            }, {} as Record<string, number>) : {},
          };
          
          return new Ok({
            success: true,
            extraction: {
              datasourceLuid,
              extractedAt: new Date().toISOString(),
              rowsExtracted: result.rowCount,
              maxRowsRequested: maxRows,
              wasLimited: result.rowCount >= maxRows,
            },
            data: result.data,
            metadata: includeMetadata ? result.metadata : undefined,
            analysis: dataAnalysis,
            dataQuality: {
              completenessScore: Math.round((1 - dataQuality.completeness) * 100), // % complete
              averageUniqueness: Object.values(dataQuality.uniqueness).length > 0 ?
                Math.round(Object.values(dataQuality.uniqueness).reduce((a, b) => a + b, 0) / 
                Object.values(dataQuality.uniqueness).length * 100) : 0,
              nullCounts: dataAnalysis.nullCounts,
            },
            performance: {
              executionTimeMs: executionTime,
              rowsPerSecond: Math.round(result.rowCount / (executionTime / 1000)),
              timeoutUsed: timeout,
              dataSizeApprox: `${Math.round(JSON.stringify(result.data).length / 1024)} KB`,
              avgRowSize: result.rowCount > 0 ? 
                Math.round(JSON.stringify(result.data).length / result.rowCount) + ' bytes' : '0 bytes',
            },
            message: `Successfully extracted ${result.rowCount} rows from data source`,
            recommendations: {
              ...(result.rowCount >= maxRows ? 
                { limitReached: 'Consider increasing maxRows or using filters for complete data' } : {}),
              ...(executionTime > timeout * 0.8 ? 
                { performance: 'Consider increasing timeout for better reliability' } : {}),
              ...(dataQuality.completeness > 0.1 ? 
                { dataQuality: 'High null count detected, consider data quality review' } : {}),
            },
          });
          
        } catch (error) {
          return new Err(`Data extraction failed: ${error}`);
        }
      },
    });
  },
});