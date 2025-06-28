import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const getDatasourceMetadataTool = new Tool({
  name: 'get-datasource-metadata',
  description: `
Retrieve comprehensive metadata information for data sources using the Tableau Metadata API (GraphQL). This provides detailed schema information including fields, data types, relationships, and connected content.

**Parameters:**
- \`datasourceLuid\`: Specific data source ID to query (optional, if not provided returns all data sources)
- \`includeFields\`: Include field-level metadata (default: true)
- \`includeTables\`: Include table/schema information (default: true)
- \`includeWorkbooks\`: Include connected workbooks (default: false)
- \`fieldTypes\`: Filter fields by data type (optional)

**Returned Metadata:**
- **Data Source Info**: ID, name, description, project details
- **Field Details**: Name, data type, role (dimension/measure), calculated field formulas
- **Table Schema**: Table names, schema information, relationships
- **Connected Content**: Workbooks that use this data source
- **Calculated Fields**: Custom calculations and their formulas

**Field Data Types:**
- \`STRING\`, \`INTEGER\`, \`REAL\`, \`BOOLEAN\`, \`DATE\`, \`DATETIME\`
- \`SPATIAL\`, \`UNKNOWN\`

**Field Roles:**
- \`DIMENSION\`: Categorical data for grouping and filtering
- \`MEASURE\`: Quantitative data for aggregation
- \`UNKNOWN\`: Role not determined

**Example Usage:**
- Get full metadata: \`{ "datasourceLuid": "ds-123", "includeFields": true, "includeTables": true }\`
- Fields only: \`{ "datasourceLuid": "ds-123", "includeFields": true, "includeTables": false }\`
- All data sources: \`{ "includeFields": false }\` (overview only)
- Filter by field type: \`{ "datasourceLuid": "ds-123", "fieldTypes": ["INTEGER", "REAL"] }\`

**Use Cases:**
- Schema discovery and documentation
- Data lineage analysis
- Field usage auditing
- Impact analysis before changes
- Automated data cataloging
`,
  paramsSchema: {
    datasourceLuid: z.string().optional(),
    includeFields: z.boolean().default(true),
    includeTables: z.boolean().default(true),
    includeWorkbooks: z.boolean().default(false),
    fieldTypes: z.array(z.enum(['STRING', 'INTEGER', 'REAL', 'BOOLEAN', 'DATE', 'DATETIME', 'SPATIAL', 'UNKNOWN'])).optional(),
  },
  annotations: {
    title: 'Get Datasource Metadata',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ 
    datasourceLuid, 
    includeFields, 
    includeTables, 
    includeWorkbooks, 
    fieldTypes 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await getDatasourceMetadataTool.logAndExecute({
      requestId,
      args: { datasourceLuid, includeFields, includeTables, includeWorkbooks, fieldTypes },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          const metadata = await restApi.metadataApi.getDatasourceSchema(
            datasourceLuid,
            {
              includeFields,
              includeTables,
              includeWorkbooks,
              fieldTypes,
            }
          );
          
          // Calculate summary statistics
          const summary = metadata.map(ds => {
            const fieldsByType = ds.fields?.reduce((acc, field) => {
              acc[field.dataType] = (acc[field.dataType] || 0) + 1;
              return acc;
            }, {} as Record<string, number>) || {};
            
            const fieldsByRole = ds.fields?.reduce((acc, field) => {
              acc[field.role] = (acc[field.role] || 0) + 1;
              return acc;
            }, {} as Record<string, number>) || {};
            
            const calculatedFields = ds.fields?.filter(f => f.isCalculated) || [];
            
            return {
              datasource: {
                id: ds.id,
                name: ds.name,
                description: ds.description,
              },
              statistics: {
                totalFields: ds.fields?.length || 0,
                totalTables: ds.tables?.length || 0,
                totalWorkbooks: ds.workbooks?.length || 0,
                calculatedFieldsCount: calculatedFields.length,
                fieldsByDataType: fieldsByType,
                fieldsByRole: fieldsByRole,
              },
              fields: includeFields ? ds.fields : undefined,
              tables: includeTables ? ds.tables : undefined,
              workbooks: includeWorkbooks ? ds.workbooks : undefined,
              calculatedFields: includeFields ? calculatedFields : undefined,
            };
          });
          
          const totalStats = {
            datasourcesCount: metadata.length,
            totalFields: summary.reduce((sum, ds) => sum + ds.statistics.totalFields, 0),
            totalTables: summary.reduce((sum, ds) => sum + ds.statistics.totalTables, 0),
            totalWorkbooks: summary.reduce((sum, ds) => sum + ds.statistics.totalWorkbooks, 0),
            totalCalculatedFields: summary.reduce((sum, ds) => sum + ds.statistics.calculatedFieldsCount, 0),
          };
          
          return new Ok({
            success: true,
            metadata: summary,
            totalStatistics: totalStats,
            message: datasourceLuid 
              ? `Retrieved metadata for data source ${datasourceLuid}`
              : `Retrieved metadata for ${metadata.length} data sources`,
            queryOptions: {
              includeFields,
              includeTables,
              includeWorkbooks,
              fieldTypesFilter: fieldTypes,
            },
          });
          
        } catch (error) {
          return new Err(`Failed to retrieve metadata: ${error}`);
        }
      },
    });
  },
});