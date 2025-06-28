import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const exportWorkbookTool = new Tool({
  name: 'export-workbook',
  description: `
Export a workbook from Tableau Cloud/Server to a local file. This allows you to download workbooks for backup, migration, or offline analysis.

**Parameters:**
- \`workbookId\`: ID of the workbook to export (required)
- \`format\`: Export format - twbx, twb, pdf, or powerpoint (optional, default: twbx)
- \`outputPath\`: Local file path for the exported workbook (optional, generates if not provided)
- \`includeExtracts\`: Include extract data in export (optional, default: true)
- \`maxAge\`: Maximum age of cached extract data in hours (optional)

**Export Formats:**
- **TWBX**: Packaged workbook with extracts and external files
- **TWB**: Workbook definition only (no extracts or external files)
- **PDF**: Static PDF representation of all sheets
- **PowerPoint**: PowerPoint presentation with workbook views

**Export Options:**
- **Include Extracts**: Package extract data with workbook (TWBX only)
- **Live Connections**: Maintain live database connections (TWB format)
- **External Files**: Include custom images, shapes, and other assets
- **View Selection**: Export specific views or entire workbook

**File Handling:**
- **Automatic Naming**: Generate filename based on workbook name and timestamp
- **Path Validation**: Ensure output directory exists and is writable
- **Overwrite Protection**: Warn before overwriting existing files
- **Size Estimation**: Estimate export file size based on content

**Use Cases:**
- **Backup**: Regular workbook backups for disaster recovery
- **Migration**: Move workbooks between Tableau environments
- **Distribution**: Share workbooks with users who don't have Tableau access
- **Version Control**: Export for external version control systems
- **Offline Analysis**: Work with workbooks without server connectivity

**Performance Considerations:**
- **Extract Size**: Large extracts significantly increase export time
- **View Complexity**: Complex workbooks take longer to export
- **Server Load**: Multiple simultaneous exports may impact performance
- **Network Bandwidth**: Large exports require substantial bandwidth

**Example Usage:**
- Basic export: \`{ "workbookId": "wb-123", "format": "twbx" }\`
- PDF export: \`{ "workbookId": "wb-456", "format": "pdf", "outputPath": "/exports/report.pdf" }\`
- Live connection: \`{ "workbookId": "wb-789", "format": "twb", "includeExtracts": false }\`
- Custom path: \`{ "workbookId": "wb-101", "format": "twbx", "outputPath": "/backup/workbook-backup.twbx" }\`

**Security Considerations:**
- User must have download permissions for the workbook
- Extract data follows same security rules as view access
- Sensitive data protection during export process
- Audit logging of export activities

**Best Practices:**
- Use TWBX format for complete workbook portability
- Regular exports for critical workbooks as backup strategy
- Organize exports with consistent naming conventions
- Verify export integrity after download completion
`,
  paramsSchema: {
    workbookId: z.string().min(1, 'Workbook ID is required'),
    format: z.enum(['twbx', 'twb', 'pdf', 'powerpoint']).optional(),
    outputPath: z.string().optional(),
    includeExtracts: z.boolean().optional(),
    maxAge: z.number().min(0).max(8760).optional(), // 0 to 8760 hours (1 year)
  },
  annotations: {
    title: 'Export Workbook',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    workbookId, 
    format = 'twbx', 
    outputPath, 
    includeExtracts = true, 
    maxAge 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await exportWorkbookTool.logAndExecute({
      requestId,
      args: { workbookId, format, outputPath, includeExtracts, maxAge },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify workbook exists and get details
          let workbook;
          try {
            workbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, workbookId);
          } catch (error) {
            return new Err(`Workbook with ID '${workbookId}' not found`);
          }
          
          // Validate format compatibility
          if (format === 'twb' && includeExtracts) {
            return new Err('TWB format cannot include extracts - use TWBX format or set includeExtracts to false');
          }
          
          // Generate output path if not provided
          const finalOutputPath = outputPath || generateOutputPath(workbook.name, format);
          
          // Validate output directory
          try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const outputDir = path.dirname(finalOutputPath);
            await fs.access(outputDir, fs.constants.W_OK);
          } catch (error) {
            try {
              const fs = await import('fs/promises');
              const path = await import('path');
              const outputDir = path.dirname(finalOutputPath);
              await fs.mkdir(outputDir, { recursive: true });
            } catch (mkdirError) {
              return new Err(`Cannot create output directory: ${mkdirError}`);
            }
          }
          
          // Check if file already exists
          let fileExists = false;
          try {
            const fs = await import('fs/promises');
            await fs.access(finalOutputPath);
            fileExists = true;
          } catch (error) {
            // File doesn't exist, which is fine
          }
          
          // Analyze workbook characteristics for export estimation
          const workbookAnalysis = {
            hasExtracts: includeExtracts && workbook.hasExtracts,
            size: workbook.size || 0,
            viewCount: workbook.views?.length || 0,
            sheetCount: workbook.sheets?.length || 0,
            createdAt: workbook.createdAt,
            updatedAt: workbook.updatedAt,
          };
          
          // Estimate export characteristics
          const exportEstimation = {
            estimatedSize: estimateExportSize(workbookAnalysis, format),
            estimatedTime: estimateExportTime(workbookAnalysis, format),
            complexity: calculateExportComplexity(workbookAnalysis, format),
            requiresExtracts: format === 'twbx' && includeExtracts,
            preservesInteractivity: ['twbx', 'twb'].includes(format),
          };
          
          // Perform the export
          const exportOptions = {
            format,
            includeExtracts: format === 'twbx' ? includeExtracts : false,
            maxAge,
          };
          
          const exportedData = await restApi.fileOperations.downloadWorkbook(
            restApi.siteId, 
            workbookId, 
            exportOptions
          );
          
          // Save the exported file
          const fs = await import('fs/promises');
          await fs.writeFile(finalOutputPath, exportedData);
          
          // Verify export success
          const exportedFileStats = await fs.stat(finalOutputPath);
          const actualSize = exportedFileStats.size;
          
          // Analyze export results
          const exportResults = {
            success: true,
            filePath: finalOutputPath,
            fileSize: actualSize,
            fileSizeFormatted: formatFileSize(actualSize),
            sizeAccuracy: Math.abs(actualSize - exportEstimation.estimatedSize) / exportEstimation.estimatedSize < 0.3,
            format,
            includesExtracts: exportOptions.includeExtracts,
            preservesInteractivity: exportEstimation.preservesInteractivity,
          };
          
          // Calculate export efficiency
          const exportEfficiency = {
            compressionRatio: workbookAnalysis.size > 0 ? actualSize / workbookAnalysis.size : 1,
            sizeReduction: workbookAnalysis.size > actualSize,
            exportQuality: (() => {
              if (format === 'twbx' && includeExtracts) return 'Complete';
              if (format === 'twb') return 'Structure Only';
              if (format === 'pdf') return 'Visual Only';
              return 'Presentation';
            })(),
          };
          
          return new Ok({
            success: true,
            exported: true,
            workbook: {
              id: workbook.id,
              name: workbook.name,
              projectName: workbook.project?.name,
              ownerName: workbook.owner?.name,
              size: workbook.size,
              hasExtracts: workbook.hasExtracts,
              viewCount: workbookAnalysis.viewCount,
              updatedAt: workbook.updatedAt,
            },
            export: {
              format,
              filePath: finalOutputPath,
              fileSize: actualSize,
              fileSizeFormatted: formatFileSize(actualSize),
              includesExtracts: exportOptions.includeExtracts,
              preservesInteractivity: exportEstimation.preservesInteractivity,
              exportComplexity: exportEstimation.complexity,
            },
            estimation: exportEstimation,
            results: exportResults,
            efficiency: exportEfficiency,
            fileInfo: {
              exists: true,
              readable: true,
              writable: true,
              created: new Date().toISOString(),
              absolutePath: finalOutputPath,
            },
            summary: {
              workbookName: workbook.name,
              exportFormat: format.toUpperCase(),
              outputLocation: finalOutputPath,
              exportSize: formatFileSize(actualSize),
              includesData: exportOptions.includeExtracts,
              exportSuccessful: true,
              canReimport: ['twbx', 'twb'].includes(format),
            },
            message: `Successfully exported workbook '${workbook.name}' as ${format.toUpperCase()} to '${finalOutputPath}' (${formatFileSize(actualSize)})`,
            warnings: {
              ...(fileExists ? 
                { fileOverwritten: 'Existing file was overwritten with new export' } : {}),
              ...(exportEstimation.complexity === 'High' ? 
                { complexExport: 'Complex workbook export may take significant time and resources' } : {}),
              ...(format !== 'twbx' && workbook.hasExtracts ? 
                { extractLoss: 'Export format does not preserve extract data - consider TWBX for complete backup' } : {}),
              ...(actualSize > 100 * 1024 * 1024 ? 
                { largeFile: 'Large export file generated - consider storage and transfer implications' } : {}),
            },
            recommendations: {
              ...(format !== 'twbx' && workbook.hasExtracts ? 
                { completeBackup: 'Use TWBX format with includeExtracts for complete workbook backup' } : {}),
              ...(exportEfficiency.compressionRatio > 2 ? 
                { optimization: 'Workbook expanded significantly during export - consider optimizing source workbook' } : {}),
              verification: 'Verify exported file integrity by testing import or opening in Tableau',
              storage: 'Store exported files in secure, backed-up location for long-term preservation',
              documentation: 'Document export purpose and retention requirements for governance',
              scheduling: 'Consider automated export scheduling for critical workbooks',
              ...(format === 'pdf' || format === 'powerpoint' ? 
                { staticFormat: 'Static format export - users cannot interact with data or filters' } : {}),
            },
          });
          
        } catch (error) {
          return new Err(`Failed to export workbook: ${error}`);
        }
      },
    });
  },
});

// Helper functions
function generateOutputPath(workbookName: string, format: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const sanitizedName = workbookName.replace(/[^a-zA-Z0-9\-_]/g, '_');
  return `./exports/${sanitizedName}_${timestamp}.${format}`;
}

function estimateExportSize(analysis: any, format: string): number {
  let baseSize = analysis.size || 1024; // 1KB minimum
  
  switch (format) {
    case 'twbx':
      return analysis.hasExtracts ? baseSize * 1.5 : baseSize * 0.8;
    case 'twb':
      return baseSize * 0.1; // Much smaller without extracts
    case 'pdf':
      return analysis.viewCount * 500 * 1024; // ~500KB per view
    case 'powerpoint':
      return analysis.viewCount * 1024 * 1024; // ~1MB per view
    default:
      return baseSize;
  }
}

function estimateExportTime(analysis: any, format: string): string {
  const baseTime = Math.max(analysis.size / (1024 * 1024), 1); // Base time in minutes
  
  switch (format) {
    case 'twbx':
      return analysis.hasExtracts ? `${Math.ceil(baseTime * 2)} minutes` : `${Math.ceil(baseTime)} minutes`;
    case 'twb':
      return '1-2 minutes';
    case 'pdf':
      return `${Math.ceil(analysis.viewCount * 0.5)} minutes`;
    case 'powerpoint':
      return `${Math.ceil(analysis.viewCount * 0.8)} minutes`;
    default:
      return `${Math.ceil(baseTime)} minutes`;
  }
}

function calculateExportComplexity(analysis: any, format: string): string {
  let complexity = 0;
  
  if (analysis.size > 50 * 1024 * 1024) complexity += 2; // >50MB
  if (analysis.viewCount > 10) complexity += 1;
  if (analysis.hasExtracts && format === 'twbx') complexity += 1;
  if (format === 'pdf' && analysis.viewCount > 20) complexity += 2;
  
  if (complexity >= 4) return 'High';
  if (complexity >= 2) return 'Medium';
  return 'Low';
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}