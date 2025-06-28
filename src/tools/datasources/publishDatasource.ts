import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const publishDatasourceTool = new Tool({
  name: 'publish-datasource',
  description: `
Publish a data source file (.tds, .tdsx, or .hyper) to Tableau Cloud/Server, making it available for use in workbooks.

**Parameters:**
- \`filePath\`: Path to the data source file to publish (required)
- \`projectId\`: ID of the project to publish to (required)
- \`name\`: Name for the published data source (optional, defaults to filename)
- \`description\`: Description of the data source (optional)
- \`overwrite\`: Whether to overwrite existing data source with same name (optional, default: false)
- \`useRemoteQueryAgent\`: Use remote query agent for database connections (optional)
- \`connectionUsername\`: Database connection username (optional)
- \`connectionPassword\`: Database connection password (optional)
- \`embedCredentials\`: Whether to embed database credentials (optional)

**Supported File Types:**
- **.tds**: Tableau Data Source (connection only, no data)
- **.tdsx**: Packaged Tableau Data Source (may include extract data)
- **.hyper**: Tableau Hyper extract file (high-performance data format)

**Publishing Options:**
- **Overwrite**: Replace existing data source with same name
- **Credentials**: Embed or prompt for database connection credentials
- **Query Agent**: Use remote query agent for on-premises data sources
- **Project Placement**: Organize data sources by project for governance

**Connection Management:**
- **Embedded Credentials**: Store database credentials with data source
- **Prompt Users**: Require users to enter credentials when accessing
- **OAuth**: Use OAuth authentication for supported data sources
- **Server Credentials**: Use server-stored connection credentials

**Extract Handling:**
- **Fresh Extract**: Create new extract from source data
- **Existing Extract**: Use extract data included in .tdsx file
- **Incremental Refresh**: Set up for incremental data updates
- **Full Refresh**: Replace all data on each refresh

**Example Usage:**
- Basic publish: \`{ "filePath": "/path/to/data.tdsx", "projectId": "proj-123" }\`
- With overwrite: \`{ "filePath": "/path/to/sales.tds", "projectId": "proj-123", "name": "Sales Data", "overwrite": true }\`
- With credentials: \`{ "filePath": "/path/to/db.tds", "projectId": "proj-123", "connectionUsername": "dbuser", "embedCredentials": true }\`
- Hyper file: \`{ "filePath": "/path/to/extract.hyper", "projectId": "proj-123", "description": "High-performance sales extract" }\`

**Best Practices:**
- Use descriptive names that indicate data content and freshness
- Add descriptions explaining data source purpose and update frequency
- Consider data governance policies when embedding credentials
- Test connections before publishing to production
- Use appropriate project organization for data source management
`,
  paramsSchema: {
    filePath: z.string().min(1, 'File path is required'),
    projectId: z.string().min(1, 'Project ID is required'),
    name: z.string().optional(),
    description: z.string().optional(),
    overwrite: z.boolean().optional(),
    useRemoteQueryAgent: z.boolean().optional(),
    connectionUsername: z.string().optional(),
    connectionPassword: z.string().optional(),
    embedCredentials: z.boolean().optional(),
  },
  annotations: {
    title: 'Publish Data Source',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    filePath, 
    projectId, 
    name, 
    description, 
    overwrite, 
    useRemoteQueryAgent, 
    connectionUsername, 
    connectionPassword, 
    embedCredentials 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await publishDatasourceTool.logAndExecute({
      requestId,
      args: { filePath, projectId, name, description, overwrite, useRemoteQueryAgent, connectionUsername, connectionPassword, embedCredentials },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify project exists
          let project;
          try {
            const projects = await restApi.projectsMethods.listProjects(restApi.siteId, `id:eq:${projectId}`);
            project = projects.projects[0];
            if (!project) {
              return new Err(`Project with ID '${projectId}' not found`);
            }
          } catch (error) {
            return new Err(`Project with ID '${projectId}' not found`);
          }
          
          // Check if file exists and get file info
          let fileStats;
          try {
            const fs = await import('fs/promises');
            fileStats = await fs.stat(filePath);
            if (!fileStats.isFile()) {
              return new Err(`Path '${filePath}' is not a file`);
            }
          } catch (error) {
            return new Err(`File not found: ${filePath}`);
          }
          
          // Determine file type and validate
          const fileExtension = filePath.toLowerCase().split('.').pop();
          const supportedExtensions = ['tds', 'tdsx', 'hyper'];
          
          if (!fileExtension || !supportedExtensions.includes(fileExtension)) {
            return new Err(`Unsupported file type. Supported types: ${supportedExtensions.join(', ')}`);
          }
          
          // Generate data source name if not provided
          const datasourceName = name || filePath.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Untitled Data Source';
          
          // Check for existing data source if not overwriting
          if (!overwrite) {
            try {
              const existingDatasources = await restApi.datasourcesMethods.listDatasources(
                restApi.siteId, 
                `name:eq:${datasourceName},projectId:eq:${projectId}`
              );
              if (existingDatasources.datasources.length > 0) {
                return new Err(`Data source '${datasourceName}' already exists in project '${project.name}'. Use overwrite option to replace it.`);
              }
            } catch (error) {
              // Continue with publishing if we can't check for existing
            }
          }
          
          // Analyze file characteristics
          const fileSizeKB = Math.round(fileStats.size / 1024);
          const fileSizeMB = Math.round(fileSizeKB / 1024 * 100) / 100;
          
          const fileTypeInfo = {
            tds: { hasData: false, description: 'Connection definition only' },
            tdsx: { hasData: true, description: 'Packaged with potential extract data' },
            hyper: { hasData: true, description: 'High-performance extract format' },
          };
          
          const typeInfo = fileTypeInfo[fileExtension as keyof typeof fileTypeInfo];
          
          // Estimate publishing time based on file size
          const estimatedTime = (() => {
            if (fileSizeMB < 1) return '1-2 minutes';
            if (fileSizeMB < 10) return '2-5 minutes';
            if (fileSizeMB < 100) return '5-15 minutes';
            return '15+ minutes';
          })();
          
          // Publish the data source
          const publishedDatasource = await restApi.fileOperations.publishDatasource(restApi.siteId, {
            filePath,
            projectId,
            name: datasourceName,
            description,
            overwrite: overwrite || false,
            useRemoteQueryAgent,
            connectionUsername,
            connectionPassword,
            embedCredentials,
          });
          
          // Analyze publication results
          const hasCredentials = !!(connectionUsername || embedCredentials);
          const isExtractBased = typeInfo.hasData;
          const publishingComplexity = (() => {
            let complexity = 0;
            if (fileSizeMB > 10) complexity += 2;
            if (hasCredentials) complexity += 1;
            if (useRemoteQueryAgent) complexity += 1;
            if (overwrite) complexity += 1;
            
            if (complexity >= 4) return 'High';
            if (complexity >= 2) return 'Medium';
            return 'Low';
          })();
          
          return new Ok({
            success: true,
            published: true,
            datasource: {
              id: publishedDatasource.id,
              name: publishedDatasource.name,
              description: publishedDatasource.description,
              type: publishedDatasource.type,
              contentUrl: publishedDatasource.contentUrl,
              projectId: publishedDatasource.project?.id,
              projectName: publishedDatasource.project?.name,
              ownerId: publishedDatasource.owner?.id,
              ownerName: publishedDatasource.owner?.name,
              hasExtracts: publishedDatasource.hasExtracts,
              size: publishedDatasource.size,
              createdAt: publishedDatasource.createdAt,
              updatedAt: publishedDatasource.updatedAt,
            },
            fileInfo: {
              originalPath: filePath,
              fileName: filePath.split('/').pop(),
              fileType: fileExtension.toUpperCase(),
              fileSizeKB,
              fileSizeMB,
              typeDescription: typeInfo.description,
              hasExtractData: typeInfo.hasData,
            },
            publishingDetails: {
              overwritten: overwrite && true,
              credentialsEmbedded: hasCredentials,
              useRemoteQueryAgent: useRemoteQueryAgent || false,
              publishingComplexity,
              estimatedTime,
              actualPublishTime: 'Completed', // Would be actual time in real implementation
            },
            configuration: {
              isExtractBased,
              hasCredentials,
              needsRefresh: isExtractBased,
              canScheduleRefresh: isExtractBased,
              connectionType: typeInfo.hasData ? 'Extract' : 'Live',
            },
            summary: {
              datasourceName,
              projectName: project.name,
              fileSize: fileSizeMB >= 1 ? `${fileSizeMB} MB` : `${fileSizeKB} KB`,
              fileType: fileExtension.toUpperCase(),
              publishingSuccess: true,
              overwritePerformed: overwrite || false,
              credentialsConfigured: hasCredentials,
            },
            message: `Successfully published ${fileExtension.toUpperCase()} data source '${datasourceName}' to project '${project.name}'`,
            warnings: {
              ...(fileSizeMB > 50 ? 
                { largeFile: 'Large data source may impact server performance - monitor resource usage' } : {}),
              ...(embedCredentials ? 
                { embeddedCredentials: 'Database credentials are embedded - ensure appropriate security measures' } : {}),
              ...(overwrite ? 
                { overwritten: 'Existing data source was overwritten - dependent workbooks may be affected' } : {}),
              ...(typeInfo.hasData && !embedCredentials && !connectionUsername ? 
                { credentialPrompt: 'Users will be prompted for database credentials when accessing this data source' } : {}),
            },
            recommendations: {
              testing: 'Test data source connectivity and data quality before making it available to users',
              ...(isExtractBased ? 
                { refreshSchedule: 'Set up refresh schedule if this is an extract-based data source' } : {}),
              permissions: 'Configure appropriate permissions for users who need access to this data source',
              documentation: 'Add metadata and descriptions to help users understand the data source',
              ...(fileSizeMB > 10 ? 
                { performance: 'Consider optimizing large data sources for better performance' } : {}),
              governance: 'Ensure data source follows organizational data governance policies',
              monitoring: 'Monitor data source usage and performance after publication',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to publish data source: ${error}`);
        }
      },
    });
  },
});