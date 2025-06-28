import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listViewsTool = new Tool({
  name: 'list-views',
  description: `
List all views (individual worksheets) in Tableau Cloud/Server. Views are individual visualization sheets within workbooks.

**Parameters:**
- \`filter\`: Filter expression to limit results (optional)
- \`pageSize\`: Number of views to return per page (optional, default: 100)
- \`pageNumber\`: Page number for pagination (optional, default: 1)
- \`workbookId\`: Limit to views from specific workbook (optional)
- \`projectId\`: Limit to views from specific project (optional)

**View Information Includes:**
- **Basic Details**: Name, content URL, view URL name
- **Parent Objects**: Workbook and project information
- **Ownership**: Creator and owner details
- **Metadata**: Creation/update timestamps, tags
- **Visibility**: Hidden status for sheet tabs
- **Usage**: View count statistics (if available)

**Filter Examples:**
- \`name:has:Dashboard\`: Views with "Dashboard" in name
- \`workbookName:eq:Sales\`: Views from "Sales" workbook
- \`projectName:eq:Marketing\`: Views from Marketing project
- \`hidden:eq:false\`: Only visible views
- \`tags:has:KPI\`: Views tagged with "KPI"

**Example Usage:**
- All views: \`{}\`
- Views in specific workbook: \`{ "workbookId": "wb-123" }\`
- Dashboard views only: \`{ "filter": "name:has:Dashboard" }\`
- Recent views: \`{ "filter": "updatedAt:gte:2024-01-01" }\`
- Popular views: \`{ "filter": "totalViewCount:gte:100" }\`

**Use Cases:**
- Content inventory and cataloging
- Usage analysis and optimization
- View organization and governance
- Performance monitoring
- Content migration planning
- User access patterns analysis
`,
  paramsSchema: {
    filter: z.string().optional(),
    pageSize: z.number().min(1).max(1000).optional(),
    pageNumber: z.number().min(1).optional(),
    workbookId: z.string().optional(),
    projectId: z.string().optional(),
  },
  annotations: {
    title: 'List Views',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ filter, pageSize, pageNumber, workbookId, projectId }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listViewsTool.logAndExecute({
      requestId,
      args: { filter, pageSize, pageNumber, workbookId, projectId },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Build comprehensive filter
          const filterParts: string[] = [];
          if (filter) filterParts.push(filter);
          if (workbookId) filterParts.push(`workbookId:eq:${workbookId}`);
          if (projectId) filterParts.push(`projectId:eq:${projectId}`);
          const combinedFilter = filterParts.length > 0 ? filterParts.join(',') : undefined;
          
          const response = await restApi.viewsMethods.listViews(restApi.siteId, combinedFilter, pageSize, pageNumber);
          
          // Analyze view composition
          const hiddenViews = response.views.filter(v => v.hidden);
          const visibleViews = response.views.filter(v => !v.hidden);
          const viewsWithTags = response.views.filter(v => v.tags && v.tags.length > 0);
          const viewsWithUsage = response.views.filter(v => v.usage?.totalViewCount);
          
          // Group by workbook and project
          const workbookGroups = response.views.reduce((acc, view) => {
            const key = view.workbook.name;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          const projectGroups = response.views.reduce((acc, view) => {
            const key = view.project.name;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          // Analyze view types and naming patterns
          const dashboardViews = response.views.filter(v => 
            v.name.toLowerCase().includes('dashboard') || 
            v.name.toLowerCase().includes('summary') ||
            v.name.toLowerCase().includes('overview')
          );
          
          const detailViews = response.views.filter(v => 
            v.name.toLowerCase().includes('detail') || 
            v.name.toLowerCase().includes('drill') ||
            v.name.toLowerCase().includes('breakdown')
          );
          
          // Calculate usage statistics
          const totalViews = viewsWithUsage.reduce((sum, view) => sum + (view.usage?.totalViewCount || 0), 0);
          const averageUsage = viewsWithUsage.length > 0 ? Math.round(totalViews / viewsWithUsage.length) : 0;
          
          const mostPopularView = viewsWithUsage.length > 0 
            ? viewsWithUsage.reduce((max, view) => 
                (view.usage?.totalViewCount || 0) > (max.usage?.totalViewCount || 0) ? view : max
              )
            : null;
          
          // Tag analysis
          const allTags = response.views.flatMap(v => v.tags || []);
          const tagCounts = allTags.reduce((acc, tag) => {
            acc[tag] = (acc[tag] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          const topTags = Object.entries(tagCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .map(([tag, count]) => ({ tag, count }));
          
          return new Ok({
            success: true,
            views: response.views.map(view => ({
              id: view.id,
              name: view.name,
              contentUrl: view.contentUrl,
              viewUrlName: view.viewUrlName,
              workbook: {
                id: view.workbook.id,
                name: view.workbook.name,
              },
              project: {
                id: view.project.id,
                name: view.project.name,
              },
              owner: {
                id: view.owner.id,
                name: view.owner.name,
              },
              createdAt: view.createdAt,
              updatedAt: view.updatedAt,
              tags: view.tags,
              hidden: view.hidden,
              sheetType: view.sheetType,
              usage: view.usage,
            })),
            pagination: response.pagination ? {
              currentPage: response.pagination.pageNumber,
              pageSize: response.pagination.pageSize,
              totalAvailable: response.pagination.totalAvailable,
              totalPages: Math.ceil(response.pagination.totalAvailable / response.pagination.pageSize),
            } : undefined,
            summary: {
              totalViews: response.views.length,
              visibleViews: visibleViews.length,
              hiddenViews: hiddenViews.length,
              viewsWithTags: viewsWithTags.length,
              viewsWithUsage: viewsWithUsage.length,
              uniqueWorkbooks: Object.keys(workbookGroups).length,
              uniqueProjects: Object.keys(projectGroups).length,
              dashboardViews: dashboardViews.length,
              detailViews: detailViews.length,
            },
            analysis: {
              workbookDistribution: workbookGroups,
              projectDistribution: projectGroups,
              viewTypeAnalysis: {
                dashboards: dashboardViews.length,
                details: detailViews.length,
                other: response.views.length - dashboardViews.length - detailViews.length,
              },
              usageStatistics: {
                totalViewCount: totalViews,
                averageViewCount: averageUsage,
                viewsWithUsageData: viewsWithUsage.length,
                mostPopularView: mostPopularView ? {
                  name: mostPopularView.name,
                  viewCount: mostPopularView.usage?.totalViewCount,
                  workbook: mostPopularView.workbook.name,
                } : null,
              },
              tagAnalysis: {
                totalTags: allTags.length,
                uniqueTags: Object.keys(tagCounts).length,
                topTags,
                averageTagsPerView: viewsWithTags.length > 0 
                  ? Math.round(allTags.length / viewsWithTags.length * 10) / 10 
                  : 0,
              },
              contentHealth: {
                hiddenViewPercentage: Math.round(hiddenViews.length / response.views.length * 100),
                taggedViewPercentage: Math.round(viewsWithTags.length / response.views.length * 100),
                viewsPerWorkbook: Math.round(response.views.length / Object.keys(workbookGroups).length * 10) / 10,
              },
            },
            message: `Found ${response.views.length} views${combinedFilter ? ` matching filter criteria` : ''}`,
            warnings: {
              ...(hiddenViews.length > response.views.length * 0.5 ? 
                { manyHiddenViews: `${hiddenViews.length} views are hidden - consider if this is intentional` } : {}),
              ...(viewsWithTags.length < response.views.length * 0.3 ? 
                { lowTagging: 'Less than 30% of views have tags - consider improving content organization' } : {}),
              ...(Object.keys(workbookGroups).some(wb => workbookGroups[wb] > 20) ? 
                { largeWorkbooks: 'Some workbooks have many views - consider splitting for better organization' } : {}),
            },
            recommendations: {
              ...(hiddenViews.length > 0 ? 
                { reviewHiddenViews: 'Review hidden views to ensure they are intentionally hidden' } : {}),
              ...(viewsWithTags.length < response.views.length * 0.5 ? 
                { improveTagging: 'Add tags to views to improve discoverability and organization' } : {}),
              ...(averageUsage > 0 ? 
                { usageOptimization: 'Focus optimization efforts on most popular views for maximum impact' } : {}),
              contentGovernance: 'Implement consistent naming conventions and tagging strategies',
              usageMonitoring: 'Regularly review view usage to identify optimization opportunities',
              organization: 'Group related views and consider workbook structure optimization',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to list views: ${error}`);
        }
      },
    });
  },
});