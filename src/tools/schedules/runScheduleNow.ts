import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const runScheduleNowTool = new Tool({
  name: 'run-schedule-now',
  description: `
Manually trigger a schedule to run immediately in Tableau Cloud/Server, bypassing the normal schedule timing.

**Parameters:**
- \`scheduleId\`: ID of the schedule to run immediately (required)
- \`scheduleName\`: Optional schedule name for reference (will be looked up if not provided)

**Manual Execution:**
- Runs the schedule immediately regardless of its normal timing
- Creates a background job that can be monitored
- Does not affect the schedule's normal recurring execution
- Useful for testing, urgent updates, or troubleshooting

**Schedule States:**
- **Active schedules**: Can be run immediately
- **Suspended schedules**: Can still be manually triggered
- **Any frequency**: Works with hourly, daily, weekly, or monthly schedules

**Use Cases:**
- **Testing**: Verify schedule works before next automatic run
- **Urgent updates**: Refresh critical data outside normal schedule
- **Troubleshooting**: Manually trigger failed schedules for debugging
- **Data recovery**: Re-run schedules after system issues
- **Business needs**: Get latest data for important meetings/decisions

**Job Creation:**
- Manual execution creates a background job
- Job can be monitored using job management tools
- Job follows same priority and execution rules as scheduled runs
- Multiple manual runs can be queued

**Example Usage:**
- Test new schedule: \`{ "scheduleId": "sched-123" }\`
- Emergency refresh: \`{ "scheduleId": "daily-sales-refresh", "scheduleName": "Daily Sales Data Refresh" }\`
- Troubleshoot failure: \`{ "scheduleId": "sched-456" }\`

**Best Practices:**
- Monitor the created job to ensure successful completion
- Consider system load before manually triggering multiple schedules
- Document reasons for manual execution for audit purposes
- Use during low-usage periods for resource-intensive schedules
- Verify data consistency after manual runs
`,
  paramsSchema: {
    scheduleId: z.string().min(1, 'Schedule ID is required'),
    scheduleName: z.string().optional(),
  },
  annotations: {
    title: 'Run Schedule Now',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ scheduleId, scheduleName }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await runScheduleNowTool.logAndExecute({
      requestId,
      args: { scheduleId, scheduleName },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Get schedule details to verify it exists and get info
          let schedule;
          try {
            schedule = await restApi.schedulesMethods.getSchedule(restApi.siteId, scheduleId);
          } catch (error) {
            return new Err(`Schedule with ID '${scheduleId}' not found`);
          }
          
          // Trigger the schedule to run now
          const result = await restApi.schedulesMethods.runScheduleNow(restApi.siteId, scheduleId);
          
          // Get job details for monitoring
          let jobDetails;
          try {
            jobDetails = await restApi.jobsMethods.getJob(restApi.siteId, result.jobId);
          } catch (error) {
            // Continue without detailed job info
          }
          
          // Analyze schedule type and expected impact
          const scheduleCategory = (() => {
            if (schedule.type === 'Extract') return 'Data Processing';
            if (schedule.type === 'Subscription') return 'Report Delivery';
            if (schedule.type === 'Flow') return 'Data Preparation';
            return 'Other';
          })();
          
          const expectedDuration = (() => {
            if (schedule.type === 'Extract') return '5-30 minutes (depends on data size)';
            if (schedule.type === 'Subscription') return '1-5 minutes (depends on recipients)';
            if (schedule.type === 'Flow') return '2-60 minutes (depends on data processing)';
            return 'Variable';
          })();
          
          const priorityLevel = schedule.priority >= 70 ? 'High' : 
                              schedule.priority >= 40 ? 'Medium' : 'Low';
          
          // Calculate time until next scheduled run
          const timeUntilNext = schedule.nextRunAt 
            ? Math.round((new Date(schedule.nextRunAt).getTime() - new Date().getTime()) / 1000 / 60) // minutes
            : null;
          
          return new Ok({
            success: true,
            execution: {
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              scheduleType: schedule.type,
              scheduleState: schedule.state,
              jobId: result.jobId,
              triggeredAt: new Date().toISOString(),
              priority: schedule.priority,
            },
            job: {
              id: result.jobId,
              status: jobDetails?.status || 'Active',
              progress: jobDetails?.progress || 0,
              type: jobDetails?.type || `${schedule.type}Schedule`,
              createdAt: jobDetails?.createdAt || new Date().toISOString(),
            },
            schedule: {
              name: schedule.name,
              description: schedule.description,
              frequency: schedule.frequency,
              normalState: schedule.state,
              nextScheduledRun: schedule.nextRunAt,
              timeUntilNextRun: timeUntilNext ? `${Math.floor(timeUntilNext / 60)}h ${timeUntilNext % 60}m` : 'Unknown',
            },
            analysis: {
              scheduleCategory,
              priorityLevel,
              expectedDuration,
              isManualExecution: true,
              affectsScheduledRuns: false,
              canBeMonitored: true,
            },
            summary: {
              executionTriggered: true,
              jobCreated: true,
              scheduleBypassedTiming: true,
              normalScheduleUnaffected: true,
              immediateExecution: schedule.state === 'Active',
            },
            message: `Successfully triggered ${schedule.type.toLowerCase()} schedule '${schedule.name}' to run now (Job ID: ${result.jobId})`,
            warnings: {
              ...(schedule.state === 'Suspended' ? 
                { suspendedSchedule: 'Schedule is suspended but manual execution still works' } : {}),
              ...(priorityLevel === 'High' ? 
                { highPriority: 'High priority execution may impact other running jobs' } : {}),
              ...(scheduleCategory === 'Data Processing' ? 
                { dataProcessing: 'Data processing jobs may take significant time and system resources' } : {}),
              resourceUsage: 'Manual execution uses system resources - monitor job progress',
            },
            recommendations: {
              monitoring: `Monitor job progress using job ID '${result.jobId}' with job management tools`,
              timing: `Expected completion: ${expectedDuration}`,
              verification: 'Verify results after job completion to ensure successful execution',
              ...(schedule.state === 'Suspended' ? 
                { scheduleState: 'Consider activating schedule if regular automatic execution is needed' } : {}),
              ...(timeUntilNext && timeUntilNext < 60 ? 
                { nextRun: `Next scheduled run is in ${Math.floor(timeUntilNext / 60)}h ${timeUntilNext % 60}m - consider if manual run is necessary` } : {}),
              documentation: 'Document reason for manual execution for audit and troubleshooting purposes',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to run schedule: ${error}`);
        }
      },
    });
  },
});