import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const queryDatasourceTool = new Tool({
  name: 'query-datasource',
  description: `
Execute custom queries against Tableau data sources using the VizQL Data Service API. Supports advanced querying with filters, grouping, ordering, and aggregations.

**Parameters:**
- \`datasourceLuid\`: Data source ID to query (required)
- \`select\`: Array of field names to select (required)
- \`filters\`: Array of filter conditions (optional)
- \`groupBy\`: Array of fields to group by (optional)
- \`orderBy\`: Array of sorting specifications (optional)
- \`limit\`: Maximum number of rows to return (optional)

**Filter Operations:**
- \`eq\`: equals (exact match)
- \`ne\`: not equals
- \`gt\`: greater than
- \`gte\`: greater than or equal
- \`lt\`: less than
- \`lte\`: less than or equal
- \`in\`: value in list
- \`contains\`: text contains substring

**Filter Examples:**
- Exact match: \`{ "field": "Region", "operator": "eq", "value": "West" }\`
- Numeric range: \`{ "field": "Sales", "operator": "gte", "value": 1000 }\`
- Multiple values: \`{ "field": "Category", "operator": "in", "value": ["Technology", "Furniture"] }\`
- Text search: \`{ "field": "Product Name", "operator": "contains", "value": "laptop" }\`

**Order By Examples:**
- Ascending: \`{ "field": "Sales", "direction": "ASC" }\`
- Descending: \`{ "field": "Profit", "direction": "DESC" }\`

**Example Usage:**
- Simple query: \`{ "datasourceLuid": "ds-123", "select": ["Region", "Sales"] }\`
- With filters: \`{ "datasourceLuid": "ds-123", "select": ["Product", "Sales"], "filters": [{"field": "Region", "operator": "eq", "value": "West"}] }\`
- Aggregated data: \`{ "datasourceLuid": "ds-123", "select": ["Region", "SUM(Sales)"], "groupBy": ["Region"], "orderBy": [{"field": "SUM(Sales)", "direction": "DESC"}] }\`
- Top 10 results: \`{ "datasourceLuid": "ds-123", "select": ["Customer", "Sales"], "orderBy": [{"field": "Sales", "direction": "DESC"}], "limit": 10 }\`

**Return Information:**
- Query results with requested fields
- Metadata about field types and roles
- Row count and execution statistics
- Performance timing information
`,
  paramsSchema: {
    datasourceLuid: z.string().min(1, 'Data source LUID is required'),
    select: z.array(z.string()).min(1, 'At least one field must be selected'),
    filters: z.array(z.object({
      field: z.string(),
      operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']),
      value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
    })).optional(),
    groupBy: z.array(z.string()).optional(),
    orderBy: z.array(z.object({
      field: z.string(),
      direction: z.enum(['ASC', 'DESC']).default('ASC'),
    })).optional(),
    limit: z.number().int().positive().max(100000).optional(),
  },
  annotations: {
    title: 'Query Datasource',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ 
    datasourceLuid, 
    select, 
    filters, 
    groupBy, 
    orderBy, 
    limit 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await queryDatasourceTool.logAndExecute({
      requestId,
      args: { datasourceLuid, select, filters, groupBy, orderBy, limit },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          const startTime = Date.now();
          
          const result = await restApi.vizqlDataServiceApi.queryDatasource({
            select,
            from: datasourceLuid,
            where: filters,
            groupBy,
            orderBy,
            limit,
          });
          
          const executionTime = Date.now() - startTime;
          
          // Analyze results
          const dataAnalysis = {
            rowCount: result.rowCount,
            columnCount: select.length,
            hasNumericData: result.data.some(row => 
              Object.values(row).some(value => typeof value === 'number')
            ),
            hasDateData: result.data.some(row =>
              Object.values(row).some(value => value instanceof Date || 
                (typeof value === 'string' && !isNaN(Date.parse(value))))
            ),
            uniqueValuesPerColumn: Object.keys(result.data[0] || {}).reduce((acc, key) => {
              const uniqueValues = new Set(result.data.map(row => row[key]));
              acc[key] = uniqueValues.size;
              return acc;
            }, {} as Record<string, number>),
          };
          
          // Sample data for preview (max 5 rows)
          const sampleData = result.data.slice(0, 5);
          
          return new Ok({
            success: true,
            query: {
              datasourceLuid,
              select,
              filters: filters || [],
              groupBy: groupBy || [],
              orderBy: orderBy || [],
              limit,
            },
            results: {
              data: result.data,
              sampleData,
              metadata: result.metadata,
              rowCount: result.rowCount,
              analysis: dataAnalysis,
            },
            performance: {
              executionTimeMs: executionTime,
              rowsPerSecond: Math.round(result.rowCount / (executionTime / 1000)),
              dataSizeApprox: `${Math.round(JSON.stringify(result.data).length / 1024)} KB`,
            },
            message: `Query executed successfully, returned ${result.rowCount} rows`,
          });
          
        } catch (error) {
          return new Err(`Query execution failed: ${error}`);
        }
      },
    });
  },
});