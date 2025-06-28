import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const getViewImageTool = new Tool({
  name: 'get-view-image',
  description: `
Generate and download a PNG image of a Tableau view. Perfect for reports, presentations, and automated documentation.

**Parameters:**
- \`viewId\`: ID of the view to capture (required)
- \`resolution\`: Image quality - high, medium, or low (optional, default: high)
- \`maxAge\`: Cache age in minutes for image generation (optional)
- \`filters\`: URL filter parameters to apply to the view (optional)
- \`outputPath\`: Local file path to save the image (optional)

**Resolution Options:**
- \`high\`: Maximum quality, larger file size (recommended for presentations)
- \`medium\`: Balanced quality and size (good for reports)
- \`low\`: Faster generation, smaller size (good for thumbnails)

**Filter Parameters:**
Apply filters to customize the view before image generation:
- Format: \`{ "Region": "West", "Year": "2024" }\`
- Uses Tableau's URL filter syntax (vf_fieldname=value)
- Filters are applied temporarily for image generation only

**Cache Behavior:**
- Images are cached server-side for performance
- \`maxAge\`: How long to use cached version (minutes)
- Newer cache = faster response, older cache = more current data
- Default cache behavior varies by server configuration

**Example Usage:**
- Basic image: \`{ "viewId": "view-123" }\`
- High quality with filters: \`{ "viewId": "view-123", "resolution": "high", "filters": { "Region": "East", "Quarter": "Q1" } }\`
- Quick thumbnail: \`{ "viewId": "view-123", "resolution": "low", "maxAge": 60 }\`
- Save to file: \`{ "viewId": "view-123", "outputPath": "/tmp/dashboard.png" }\`

**Use Cases:**
- **Automated Reporting**: Include view images in automated reports
- **Documentation**: Capture views for user guides and documentation
- **Presentations**: Generate high-quality images for presentations
- **Monitoring**: Create snapshots for change tracking
- **Thumbnails**: Generate previews for content catalogs
- **Email Reports**: Embed view images in email communications
`,
  paramsSchema: {
    viewId: z.string().min(1, 'View ID is required'),
    resolution: z.enum(['high', 'medium', 'low']).optional(),
    maxAge: z.number().min(0).max(1440).optional(), // 0-24 hours
    filters: z.record(z.string()).optional(),
    outputPath: z.string().optional(),
  },
  annotations: {
    title: 'Get View Image',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ viewId, resolution, maxAge, filters, outputPath }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await getViewImageTool.logAndExecute({
      requestId,
      args: { viewId, resolution, maxAge, filters, outputPath },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Get view details for context
          let view;
          try {
            view = await restApi.viewsMethods.getView(restApi.siteId, viewId);
          } catch (error) {
            return new Err(`View with ID '${viewId}' not found`);
          }
          
          // Generate the image
          const imageBuffer = await restApi.viewsMethods.getViewImage(restApi.siteId, viewId, {
            resolution: resolution || 'high',
            maxAge,
            vf_filters: filters,
          });
          
          // Calculate image properties
          const imageSizeKB = Math.round(imageBuffer.length / 1024);
          const imageSizeMB = Math.round(imageSizeKB / 1024 * 100) / 100;
          
          // Determine image quality metrics
          const qualityLevel = resolution || 'high';
          const expectedSize = (() => {
            switch (qualityLevel) {
              case 'high': return '500KB - 2MB';
              case 'medium': return '200KB - 800KB';
              case 'low': return '50KB - 300KB';
              default: return 'Variable';
            }
          })();
          
          // Save to file if path provided
          let savedToFile = false;
          let actualOutputPath = '';
          if (outputPath) {
            try {
              const fs = await import('fs/promises');
              await fs.writeFile(outputPath, imageBuffer);
              savedToFile = true;
              actualOutputPath = outputPath;
            } catch (error) {
              // Continue without saving, but note the error
            }
          }
          
          // Analyze filter usage
          const filterCount = filters ? Object.keys(filters).length : 0;
          const hasFilters = filterCount > 0;
          
          // Estimate generation performance
          const performanceEstimate = (() => {
            if (maxAge && maxAge > 30) return 'Fast (likely cached)';
            if (qualityLevel === 'low') return 'Fast';
            if (qualityLevel === 'medium') return 'Moderate';
            if (hasFilters) return 'Moderate (filtered)';
            return 'Standard';
          })();
          
          return new Ok({
            success: true,
            viewImage: {
              viewId: view.id,
              viewName: view.name,
              workbookName: view.workbook.name,
              projectName: view.project.name,
              resolution: qualityLevel,
              imageSizeBytes: imageBuffer.length,
              imageSizeKB,
              imageSizeMB,
              generatedAt: new Date().toISOString(),
            },
            imageData: {
              format: 'PNG',
              buffer: imageBuffer,
              base64: imageBuffer.toString('base64'),
              size: {
                bytes: imageBuffer.length,
                kilobytes: imageSizeKB,
                megabytes: imageSizeMB,
                readable: imageSizeMB >= 1 ? `${imageSizeMB} MB` : `${imageSizeKB} KB`,
              },
            },
            generation: {
              resolution: qualityLevel,
              maxAge: maxAge,
              hasFilters,
              filterCount,
              appliedFilters: filters || {},
              performanceEstimate,
              expectedSizeRange: expectedSize,
            },
            output: {
              savedToFile,
              outputPath: actualOutputPath,
              available: true,
              canDownload: true,
            },
            summary: {
              imageGenerated: true,
              quality: qualityLevel,
              size: imageSizeMB >= 1 ? `${imageSizeMB} MB` : `${imageSizeKB} KB`,
              filtered: hasFilters,
              cached: maxAge ? maxAge > 0 : false,
            },
            message: `Successfully generated ${qualityLevel} quality PNG image of view '${view.name}' (${imageSizeKB} KB)`,
            warnings: {
              ...(imageSizeKB > 5000 ? 
                { largeFile: 'Generated image is quite large - consider using medium or low resolution for faster handling' } : {}),
              ...(imageSizeKB < 10 ? 
                { smallFile: 'Generated image is very small - view may be empty or have rendering issues' } : {}),
              ...(hasFilters ? 
                { filteredView: 'Image shows filtered view - results may differ from default view state' } : {}),
              ...(outputPath && !savedToFile ? 
                { saveFailed: 'Could not save image to specified path - check permissions and path validity' } : {}),
            },
            recommendations: {
              usage: 'Use high resolution for presentations, medium for reports, low for thumbnails',
              caching: 'Set appropriate maxAge for balance between performance and data freshness',
              ...(hasFilters ? 
                { filterDocumentation: 'Document applied filters when sharing images for context' } : {}),
              ...(imageSizeKB > 2000 ? 
                { optimization: 'Consider using medium resolution to reduce file size while maintaining quality' } : {}),
              storage: 'Store generated images appropriately and consider cleanup policies for temporary files',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to generate view image: ${error}`);
        }
      },
    });
  },
});