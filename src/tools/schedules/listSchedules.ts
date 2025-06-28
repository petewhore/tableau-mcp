import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listSchedulesTool = new Tool({
  name: 'list-schedules',
  description: `
List all schedules in Tableau Cloud/Server. Schedules automate extract refreshes, subscription deliveries, and flow runs.

**Parameters:**
- \`filter\`: Filter expression to limit results (optional)
- \`pageSize\`: Number of schedules to return per page (optional, default: 100)
- \`pageNumber\`: Page number for pagination (optional, default: 1)
- \`scheduleType\`: Filter by schedule type (optional)
- \`state\`: Filter by schedule state (optional)

**Schedule Types:**
- \`Extract\`: Data source refresh schedules
- \`Subscription\`: Report and dashboard subscription deliveries
- \`Flow\`: Tableau Prep flow execution schedules

**Schedule States:**
- \`Active\`: Currently enabled and running on schedule
- \`Suspended\`: Temporarily disabled, not executing

**Schedule Frequencies:**
- \`Hourly\`: Runs multiple times per day
- \`Daily\`: Runs once per day at specified time
- \`Weekly\`: Runs on specific days of the week
- \`Monthly\`: Runs on specific day of the month

**Filter Examples:**
- \`type:eq:Extract\`: Only extract refresh schedules
- \`state:eq:Active\`: Only active schedules
- \`frequency:eq:Daily\`: Only daily schedules
- \`name:has:Refresh\`: Schedules with "Refresh" in the name

**Example Usage:**
- All schedules: \`{}\`
- Active extract schedules: \`{ "scheduleType": "Extract", "state": "Active" }\`
- Suspended schedules: \`{ "filter": "state:eq:Suspended" }\`
- Daily schedules: \`{ "filter": "frequency:eq:Daily" }\`

**Use Cases:**
- Audit scheduled operations
- Plan maintenance windows
- Optimize schedule distribution
- Troubleshoot automation issues
- Manage system load
- Review subscription schedules
`,
  paramsSchema: {
    filter: z.string().optional(),
    pageSize: z.number().min(1).max(1000).optional(),
    pageNumber: z.number().min(1).optional(),
    scheduleType: z.enum(['Extract', 'Subscription', 'Flow']).optional(),
    state: z.enum(['Active', 'Suspended']).optional(),
  },
  annotations: {
    title: 'List Schedules',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ filter, pageSize, pageNumber, scheduleType, state }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listSchedulesTool.logAndExecute({
      requestId,
      args: { filter, pageSize, pageNumber, scheduleType, state },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Build filter string
          const filterParts: string[] = [];
          if (filter) filterParts.push(filter);
          if (scheduleType) filterParts.push(`type:eq:${scheduleType}`);
          if (state) filterParts.push(`state:eq:${state}`);
          const combinedFilter = filterParts.length > 0 ? filterParts.join(',') : undefined;
          
          const response = await restApi.schedulesMethods.listSchedules(restApi.siteId, combinedFilter);
          
          // Analyze schedule composition
          const typeCounts = response.schedules.reduce((acc, schedule) => {
            acc[schedule.type] = (acc[schedule.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          const stateCounts = response.schedules.reduce((acc, schedule) => {
            acc[schedule.state] = (acc[schedule.state] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          const frequencyCounts = response.schedules.reduce((acc, schedule) => {
            acc[schedule.frequency] = (acc[schedule.frequency] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          // Analyze schedule distribution and timing
          const activeSchedules = response.schedules.filter(s => s.state === 'Active');
          const suspendedSchedules = response.schedules.filter(s => s.state === 'Suspended');
          const extractSchedules = response.schedules.filter(s => s.type === 'Extract');
          
          // Find schedules with next run times
          const upcomingSchedules = response.schedules
            .filter(s => s.nextRunAt && s.state === 'Active')
            .sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())
            .slice(0, 10);
          
          // Analyze priority distribution
          const priorityCounts = response.schedules.reduce((acc, schedule) => {
            const priority = schedule.priority >= 70 ? 'High' : schedule.priority >= 40 ? 'Medium' : 'Low';
            acc[priority] = (acc[priority] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          // Check for potential scheduling conflicts
          const hourlySchedules = activeSchedules.filter(s => s.frequency === 'Hourly').length;
          const systemLoad = (() => {
            if (hourlySchedules > 20) return 'High';
            if (hourlySchedules > 10) return 'Medium';
            return 'Low';
          })();
          
          return new Ok({
            success: true,
            schedules: response.schedules.map(schedule => ({
              id: schedule.id,
              name: schedule.name,
              description: schedule.description,
              type: schedule.type,
              frequency: schedule.frequency,
              priority: schedule.priority,
              state: schedule.state,
              createdAt: schedule.createdAt,
              updatedAt: schedule.updatedAt,
              nextRunAt: schedule.nextRunAt,
              executionOrder: schedule.executionOrder,
              frequencyDetails: schedule.frequencyDetails,
            })),
            pagination: response.pagination ? {
              currentPage: response.pagination.pageNumber,
              pageSize: response.pagination.pageSize,
              totalAvailable: response.pagination.totalAvailable,
              totalPages: Math.ceil(response.pagination.totalAvailable / response.pagination.pageSize),
            } : undefined,
            summary: {
              totalSchedules: response.schedules.length,
              activeSchedules: activeSchedules.length,
              suspendedSchedules: suspendedSchedules.length,
              extractSchedules: extractSchedules.length,
              subscriptionSchedules: typeCounts.Subscription || 0,
              flowSchedules: typeCounts.Flow || 0,
              upcomingRuns: upcomingSchedules.length,
            },
            analysis: {
              typeBreakdown: typeCounts,
              stateBreakdown: stateCounts,
              frequencyBreakdown: frequencyCounts,
              priorityBreakdown: priorityCounts,
              systemLoad,
              hasFilters: !!(filter || scheduleType || state),
              schedulingDensity: (() => {
                const dailySchedules = frequencyCounts.Daily || 0;
                const hourlySchedules = frequencyCounts.Hourly || 0;
                if (hourlySchedules > dailySchedules * 2) return 'High Frequency';
                if (dailySchedules > hourlySchedules) return 'Low Frequency';
                return 'Balanced';
              })(),
            },
            upcomingRuns: upcomingSchedules.map(schedule => ({
              id: schedule.id,
              name: schedule.name,
              type: schedule.type,
              nextRunAt: schedule.nextRunAt,
              timeUntilRun: schedule.nextRunAt 
                ? Math.round((new Date(schedule.nextRunAt).getTime() - new Date().getTime()) / 1000 / 60) // minutes
                : null,
            })),
            message: `Found ${response.schedules.length} schedules${combinedFilter ? ` matching filter criteria` : ''}`,
            warnings: {
              ...(suspendedSchedules.length > 0 ? 
                { suspendedSchedules: `${suspendedSchedules.length} schedules are suspended and not running` } : {}),
              ...(hourlySchedules > 20 ? 
                { highFrequency: 'High number of hourly schedules may cause system performance issues' } : {}),
              ...(upcomingSchedules.filter(s => s.timeUntilRun && s.timeUntilRun < 15).length > 5 ? 
                { nearTermLoad: 'Multiple schedules will run within the next 15 minutes' } : {}),
            },
            recommendations: {
              ...(suspendedSchedules.length > 0 ? 
                { reviewSuspended: 'Review suspended schedules to determine if they should be reactivated' } : {}),
              ...(systemLoad === 'High' ? 
                { loadBalancing: 'Consider spreading out high-frequency schedules to balance system load' } : {}),
              ...(extractSchedules.length > 0 ? 
                { extractOptimization: 'Consider incremental refresh strategies for frequently updated extracts' } : {}),
              maintenance: 'Plan system maintenance around active schedule windows',
              monitoring: 'Use schedule management tools to suspend/resume schedules as needed',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to list schedules: ${error}`);
        }
      },
    });
  },
});