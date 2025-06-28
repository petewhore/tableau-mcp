import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listFieldsTool = new Tool({
  name: 'list-fields',
  description: `
List and analyze fields from Tableau data sources using the Metadata API. Provides detailed field information including data types, roles, relationships, and calculated field formulas.

**Parameters:**
- \`datasourceLuid\`: Specific data source ID to query (required)
- \`searchTerm\`: Filter fields by name or description (optional)
- \`dataType\`: Filter by specific data type (optional)
- \`role\`: Filter by field role - dimension or measure (optional)
- \`includeCalculated\`: Include calculated fields (default: true)
- \`includeFormulas\`: Include calculated field formulas (default: true)

**Field Information Returned:**
- **Basic Details**: Field ID, name, description
- **Data Properties**: Data type, role (dimension/measure)
- **Calculated Fields**: Formula, calculation logic
- **Data Source**: Parent data source information
- **Usage Context**: How the field is used

**Data Types Available:**
- \`STRING\`: Text and categorical data
- \`INTEGER\`: Whole numbers
- \`REAL\`: Decimal numbers
- \`BOOLEAN\`: True/false values
- \`DATE\`: Date values
- \`DATETIME\`: Date and time values
- \`SPATIAL\`: Geographic data
- \`UNKNOWN\`: Undetermined type

**Field Roles:**
- \`DIMENSION\`: Used for grouping, filtering, and categorization
- \`MEASURE\`: Used for aggregation and mathematical operations
- \`UNKNOWN\`: Role not determined

**Example Usage:**
- All fields: \`{ "datasourceLuid": "ds-123" }\`
- Search fields: \`{ "datasourceLuid": "ds-123", "searchTerm": "sales" }\`
- Only measures: \`{ "datasourceLuid": "ds-123", "role": "MEASURE" }\`
- Numeric fields: \`{ "datasourceLuid": "ds-123", "dataType": "INTEGER" }\`
- Calculated fields only: \`{ "datasourceLuid": "ds-123", "searchTerm": "", "includeCalculated": true }\`

**Use Cases:**
- Field discovery and exploration
- Data quality assessment
- Schema documentation
- Calculated field auditing
- Field usage analysis
`,
  paramsSchema: {
    datasourceLuid: z.string().min(1, 'Data source LUID is required'),
    searchTerm: z.string().optional(),
    dataType: z.enum(['STRING', 'INTEGER', 'REAL', 'BOOLEAN', 'DATE', 'DATETIME', 'SPATIAL', 'UNKNOWN']).optional(),
    role: z.enum(['DIMENSION', 'MEASURE', 'UNKNOWN']).optional(),
    includeCalculated: z.boolean().default(true),
    includeFormulas: z.boolean().default(true),
  },
  annotations: {
    title: 'List Fields',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ 
    datasourceLuid, 
    searchTerm, 
    dataType, 
    role, 
    includeCalculated,
    includeFormulas 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listFieldsTool.logAndExecute({
      requestId,
      args: { datasourceLuid, searchTerm, dataType, role, includeCalculated, includeFormulas },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          let fields = await restApi.metadataApi.getFieldsByDatasource(datasourceLuid);
          
          // Apply filters
          if (searchTerm) {
            fields = fields.filter(field => 
              field.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
              (field.description && field.description.toLowerCase().includes(searchTerm.toLowerCase()))
            );
          }
          
          if (dataType) {
            fields = fields.filter(field => field.dataType === dataType);
          }
          
          if (role) {
            fields = fields.filter(field => field.role === role);
          }
          
          if (!includeCalculated) {
            fields = fields.filter(field => !field.isCalculated);
          }
          
          // Process fields for response
          const processedFields = fields.map(field => ({
            id: field.id,
            name: field.name,
            description: field.description,
            dataType: field.dataType,
            role: field.role,
            isCalculated: field.isCalculated,
            formula: includeFormulas ? field.formula : field.isCalculated ? '[Formula hidden]' : undefined,
            datasource: field.datasource,
          }));
          
          // Calculate statistics
          const statistics = {
            totalFields: processedFields.length,
            byDataType: processedFields.reduce((acc, field) => {
              acc[field.dataType] = (acc[field.dataType] || 0) + 1;
              return acc;
            }, {} as Record<string, number>),
            byRole: processedFields.reduce((acc, field) => {
              acc[field.role] = (acc[field.role] || 0) + 1;
              return acc;
            }, {} as Record<string, number>),
            calculatedFields: processedFields.filter(f => f.isCalculated).length,
            regularFields: processedFields.filter(f => !f.isCalculated).length,
          };
          
          // Group fields by characteristics for better organization
          const fieldGroups = {
            dimensions: processedFields.filter(f => f.role === 'DIMENSION'),
            measures: processedFields.filter(f => f.role === 'MEASURE'),
            calculatedFields: processedFields.filter(f => f.isCalculated),
            dateFields: processedFields.filter(f => f.dataType === 'DATE' || f.dataType === 'DATETIME'),
            textFields: processedFields.filter(f => f.dataType === 'STRING'),
            numericFields: processedFields.filter(f => f.dataType === 'INTEGER' || f.dataType === 'REAL'),
          };
          
          return new Ok({
            success: true,
            fields: processedFields,
            statistics,
            fieldGroups: {
              dimensions: fieldGroups.dimensions.length,
              measures: fieldGroups.measures.length,
              calculatedFields: fieldGroups.calculatedFields.length,
              dateFields: fieldGroups.dateFields.length,
              textFields: fieldGroups.textFields.length,
              numericFields: fieldGroups.numericFields.length,
            },
            datasource: processedFields.length > 0 ? processedFields[0].datasource : null,
            message: `Found ${processedFields.length} fields in data source`,
            appliedFilters: {
              searchTerm,
              dataType,
              role,
              includeCalculated,
              formulasShown: includeFormulas,
            },
          });
          
        } catch (error) {
          return new Err(`Failed to retrieve fields: ${error}`);
        }
      },
    });
  },
});