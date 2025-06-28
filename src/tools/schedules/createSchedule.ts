import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const createScheduleTool = new Tool({
  name: 'create-schedule',
  description: `
Create a new schedule in Tableau Cloud/Server to automate extract refreshes, subscription deliveries, or flow runs.

**Parameters:**
- \`name\`: Name for the schedule (required)
- \`type\`: Type of schedule - Extract, Subscription, or Flow (required)
- \`frequency\`: How often to run - Hourly, Daily, Weekly, or Monthly (required)
- \`description\`: Optional description of the schedule purpose
- \`priority\`: Priority level 1-100 (optional, default: 50)
- \`state\`: Active or Suspended (optional, default: Active)
- \`frequencyDetails\`: Detailed timing configuration (optional)

**Schedule Types:**
- \`Extract\`: Automate data source refresh operations
- \`Subscription\`: Deliver reports and dashboards via email/alerts
- \`Flow\`: Execute Tableau Prep flows for data preparation

**Frequency Options:**
- \`Hourly\`: Run multiple times per day (specify hours)
- \`Daily\`: Run once per day (specify start time)
- \`Weekly\`: Run on specific days of week (specify days and time)
- \`Monthly\`: Run on specific day of month (specify date and time)

**Priority Levels:**
- \`80-100\`: High priority (runs first, use sparingly)
- \`40-79\`: Medium priority (normal business operations)
- \`1-39\`: Low priority (background maintenance tasks)

**Frequency Details Structure:**
\`\`\`json
{
  "start": "09:00",           // Start time (HH:MM format)
  "end": "17:00",             // End time for hourly schedules
  "intervals": {
    "hours": [9, 13, 17],     // Hours for hourly schedules
    "weekdays": ["Monday", "Wednesday", "Friday"], // Days for weekly
    "monthday": 15            // Day of month for monthly
  }
}
\`\`\`

**Example Usage:**
- Daily extract refresh: \`{ "name": "Sales Data Refresh", "type": "Extract", "frequency": "Daily", "frequencyDetails": { "start": "06:00" } }\`
- Weekly report: \`{ "name": "Weekly Executive Report", "type": "Subscription", "frequency": "Weekly", "frequencyDetails": { "start": "08:00", "intervals": { "weekdays": ["Monday"] } } }\`
- Hourly data processing: \`{ "name": "Real-time Flow", "type": "Flow", "frequency": "Hourly", "frequencyDetails": { "start": "09:00", "end": "17:00", "intervals": { "hours": [9, 11, 13, 15, 17] } } }\`

**Best Practices:**
- Use descriptive names that indicate purpose and timing
- Set appropriate priorities to manage system resources
- Avoid peak hours for heavy extract refreshes
- Consider business hours for subscription deliveries
- Test with suspended state first, then activate
`,
  paramsSchema: {
    name: z.string().min(1, 'Schedule name is required'),
    type: z.enum(['Extract', 'Subscription', 'Flow']),
    frequency: z.enum(['Hourly', 'Daily', 'Weekly', 'Monthly']),
    description: z.string().optional(),
    priority: z.number().min(1).max(100).optional(),
    state: z.enum(['Active', 'Suspended']).optional(),
    frequencyDetails: z.object({
      start: z.string().optional(),
      end: z.string().optional(),
      intervals: z.object({
        hours: z.array(z.number().min(0).max(23)).optional(),
        weekdays: z.array(z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])).optional(),
        monthday: z.number().min(1).max(31).optional(),
      }).optional(),
    }).optional(),
  },
  annotations: {
    title: 'Create Schedule',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    name, 
    type, 
    frequency, 
    description, 
    priority, 
    state, 
    frequencyDetails 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await createScheduleTool.logAndExecute({
      requestId,
      args: { name, type, frequency, description, priority, state, frequencyDetails },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Check if schedule with same name already exists
          const existingSchedules = await restApi.schedulesMethods.listSchedules(
            restApi.siteId, 
            `name:eq:${name}`
          );
          
          if (existingSchedules.schedules.length > 0) {
            return new Err(`Schedule with name '${name}' already exists`);
          }
          
          // Validate frequency details
          if (frequency === 'Hourly' && frequencyDetails?.intervals?.hours && 
              (!frequencyDetails.start || !frequencyDetails.end)) {
            return new Err('Hourly schedules require both start and end times');
          }
          
          if (frequency === 'Weekly' && frequencyDetails?.intervals?.weekdays && 
              frequencyDetails.intervals.weekdays.length === 0) {
            return new Err('Weekly schedules require at least one weekday');
          }
          
          // Create the schedule
          const schedule = await restApi.schedulesMethods.createSchedule(restApi.siteId, {
            name,
            type,
            frequency,
            description,
            priority: priority || 50,
            state: state || 'Active',
            frequencyDetails,
          });
          
          // Analyze schedule configuration
          const priorityLevel = schedule.priority >= 70 ? 'High' : schedule.priority >= 40 ? 'Medium' : 'Low';
          const isActive = schedule.state === 'Active';
          
          // Calculate estimated run frequency
          const estimatedRunsPerDay = (() => {
            if (frequency === 'Hourly') {
              const hours = frequencyDetails?.intervals?.hours?.length || 24;
              return hours;
            }
            if (frequency === 'Daily') return 1;
            if (frequency === 'Weekly') {
              const days = frequencyDetails?.intervals?.weekdays?.length || 1;
              return days / 7;
            }
            if (frequency === 'Monthly') return 1 / 30;
            return 0;
          })();
          
          // Analyze schedule timing
          const timingAnalysis = {
            frequency,
            estimatedRunsPerDay: Math.round(estimatedRunsPerDay * 100) / 100,
            hasDetailedTiming: !!frequencyDetails,
            runsInBusinessHours: (() => {
              if (!frequencyDetails?.start) return 'Unknown';
              const startHour = parseInt(frequencyDetails.start.split(':')[0]);
              return startHour >= 8 && startHour <= 17 ? 'Yes' : 'No';
            })(),
          };
          
          return new Ok({
            success: true,
            schedule: {
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
              frequencyDetails: schedule.frequencyDetails,
            },
            configuration: {
              priorityLevel,
              isActive,
              scheduleType: type,
              frequencyType: frequency,
              estimatedRunsPerDay,
              hasCustomTiming: !!frequencyDetails,
            },
            timing: timingAnalysis,
            summary: {
              scheduleCreated: true,
              willRunAutomatically: isActive,
              nextExecution: schedule.nextRunAt || 'To be calculated',
              resourceImpact: priorityLevel,
            },
            message: `Successfully created ${frequency.toLowerCase()} ${type.toLowerCase()} schedule '${schedule.name}' with ${priorityLevel.toLowerCase()} priority`,
            warnings: {
              ...(priorityLevel === 'High' ? 
                { highPriority: 'High priority schedules should be used sparingly to avoid resource contention' } : {}),
              ...(estimatedRunsPerDay > 24 ? 
                { frequentRuns: 'Schedule will run very frequently - monitor system performance' } : {}),
              ...(timingAnalysis.runsInBusinessHours === 'Yes' && type === 'Extract' ? 
                { businessHours: 'Extract refreshes during business hours may impact user experience' } : {}),
            },
            recommendations: {
              testing: isActive ? 
                'Monitor the first few executions to ensure schedule works as expected' :
                'Schedule is suspended - activate when ready to begin automatic execution',
              ...(type === 'Extract' ? 
                { extractOptimization: 'Consider incremental refresh strategies for large data sources' } : {}),
              ...(type === 'Subscription' ? 
                { subscriptionTesting: 'Test subscription delivery before relying on automated schedule' } : {}),
              ...(estimatedRunsPerDay > 12 ? 
                { loadBalancing: 'Consider distributing high-frequency schedules across different time periods' } : {}),
              monitoring: 'Use schedule management tools to monitor execution and adjust timing as needed',
              documentation: 'Document the business purpose and dependencies of this schedule',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to create schedule: ${error}`);
        }
      },
    });
  },
});