import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const updateScheduleTool = new Tool({
  name: 'update-schedule',
  description: `
Update an existing schedule in Tableau Cloud/Server. Modify timing, priority, state, or other schedule properties.

**Parameters:**
- \`scheduleId\`: ID of the schedule to update (required)
- \`name\`: New name for the schedule (optional)
- \`description\`: New description (optional)
- \`frequency\`: New frequency - Hourly, Daily, Weekly, or Monthly (optional)
- \`priority\`: New priority level 1-100 (optional)
- \`state\`: New state - Active or Suspended (optional)
- \`frequencyDetails\`: New detailed timing configuration (optional)

**Updatable Properties:**
- **Name**: Change schedule display name
- **Description**: Update schedule documentation
- **Frequency**: Change how often schedule runs
- **Priority**: Adjust execution priority (1-100)
- **State**: Activate or suspend schedule
- **Timing**: Modify detailed frequency settings

**Common Update Scenarios:**
- **Suspend for maintenance**: Change state to 'Suspended'
- **Adjust timing**: Modify frequency or frequencyDetails
- **Change priority**: Increase/decrease execution priority
- **Rename**: Update name for better organization
- **Frequency change**: Switch from daily to weekly, etc.

**State Changes:**
- \`Active → Suspended\`: Stops automatic execution
- \`Suspended → Active\`: Resumes automatic execution
- State changes take effect immediately

**Priority Guidelines:**
- \`80-100\`: Critical business operations
- \`40-79\`: Standard business schedules
- \`1-39\`: Background and maintenance tasks

**Example Usage:**
- Suspend schedule: \`{ "scheduleId": "sched-123", "state": "Suspended" }\`
- Change to weekly: \`{ "scheduleId": "sched-123", "frequency": "Weekly", "frequencyDetails": { "start": "06:00", "intervals": { "weekdays": ["Monday", "Wednesday"] } } }\`
- Increase priority: \`{ "scheduleId": "sched-123", "priority": 80 }\`
- Rename and describe: \`{ "scheduleId": "sched-123", "name": "Updated Sales Refresh", "description": "Daily sales data refresh for reporting" }\`

**Best Practices:**
- Suspend before making timing changes during business hours
- Test frequency changes with non-critical schedules first
- Document reasons for priority changes
- Consider downstream dependencies when changing timing
- Activate schedules during low-usage periods
`,
  paramsSchema: {
    scheduleId: z.string().min(1, 'Schedule ID is required'),
    name: z.string().optional(),
    description: z.string().optional(),
    frequency: z.enum(['Hourly', 'Daily', 'Weekly', 'Monthly']).optional(),
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
    title: 'Update Schedule',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    scheduleId, 
    name, 
    description, 
    frequency, 
    priority, 
    state, 
    frequencyDetails 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await updateScheduleTool.logAndExecute({
      requestId,
      args: { scheduleId, name, description, frequency, priority, state, frequencyDetails },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Get current schedule details
          let originalSchedule;
          try {
            originalSchedule = await restApi.schedulesMethods.getSchedule(restApi.siteId, scheduleId);
          } catch (error) {
            return new Err(`Schedule with ID '${scheduleId}' not found`);
          }
          
          // Check if any updates are actually being made
          const hasChanges = name !== undefined || 
                           description !== undefined || 
                           frequency !== undefined || 
                           priority !== undefined || 
                           state !== undefined || 
                           frequencyDetails !== undefined;
          
          if (!hasChanges) {
            return new Err('No update parameters provided - specify at least one property to update');
          }
          
          // Validate frequency details if frequency is being changed
          if (frequency === 'Hourly' && frequencyDetails?.intervals?.hours && 
              (!frequencyDetails.start || !frequencyDetails.end)) {
            return new Err('Hourly schedules require both start and end times');
          }
          
          if (frequency === 'Weekly' && frequencyDetails?.intervals?.weekdays && 
              frequencyDetails.intervals.weekdays.length === 0) {
            return new Err('Weekly schedules require at least one weekday');
          }
          
          // Update the schedule
          const updatedSchedule = await restApi.schedulesMethods.updateSchedule(restApi.siteId, scheduleId, {
            name,
            description,
            frequency,
            priority,
            state,
            frequencyDetails,
          });
          
          // Analyze changes made
          const changes = {
            nameChanged: name !== undefined && name !== originalSchedule.name,
            descriptionChanged: description !== undefined && description !== (originalSchedule.description || ''),
            frequencyChanged: frequency !== undefined && frequency !== originalSchedule.frequency,
            priorityChanged: priority !== undefined && priority !== originalSchedule.priority,
            stateChanged: state !== undefined && state !== originalSchedule.state,
            timingChanged: frequencyDetails !== undefined,
          };
          
          const changeCount = Object.values(changes).filter(Boolean).length;
          
          // Analyze impact of changes
          const stateTransition = originalSchedule.state !== updatedSchedule.state 
            ? `${originalSchedule.state} → ${updatedSchedule.state}`
            : null;
          
          const priorityChange = originalSchedule.priority !== updatedSchedule.priority
            ? `${originalSchedule.priority} → ${updatedSchedule.priority}`
            : null;
          
          const newPriorityLevel = updatedSchedule.priority >= 70 ? 'High' : 
                                 updatedSchedule.priority >= 40 ? 'Medium' : 'Low';
          
          // Calculate new estimated run frequency
          const estimatedRunsPerDay = (() => {
            const freq = updatedSchedule.frequency;
            if (freq === 'Hourly') {
              const hours = updatedSchedule.frequencyDetails?.intervals?.hours?.length || 24;
              return hours;
            }
            if (freq === 'Daily') return 1;
            if (freq === 'Weekly') {
              const days = updatedSchedule.frequencyDetails?.intervals?.weekdays?.length || 1;
              return days / 7;
            }
            if (freq === 'Monthly') return 1 / 30;
            return 0;
          })();
          
          return new Ok({
            success: true,
            schedule: {
              id: updatedSchedule.id,
              name: updatedSchedule.name,
              description: updatedSchedule.description,
              type: updatedSchedule.type,
              frequency: updatedSchedule.frequency,
              priority: updatedSchedule.priority,
              state: updatedSchedule.state,
              createdAt: updatedSchedule.createdAt,
              updatedAt: updatedSchedule.updatedAt,
              nextRunAt: updatedSchedule.nextRunAt,
              frequencyDetails: updatedSchedule.frequencyDetails,
            },
            changes: {
              totalChanges: changeCount,
              nameChanged: changes.nameChanged,
              descriptionChanged: changes.descriptionChanged,
              frequencyChanged: changes.frequencyChanged,
              priorityChanged: changes.priorityChanged,
              stateChanged: changes.stateChanged,
              timingChanged: changes.timingChanged,
              stateTransition,
              priorityChange,
            },
            analysis: {
              originalState: originalSchedule.state,
              newState: updatedSchedule.state,
              originalPriority: originalSchedule.priority,
              newPriority: updatedSchedule.priority,
              newPriorityLevel,
              isNowActive: updatedSchedule.state === 'Active',
              estimatedRunsPerDay: Math.round(estimatedRunsPerDay * 100) / 100,
              nextExecution: updatedSchedule.nextRunAt,
            },
            summary: {
              scheduleUpdated: true,
              changesApplied: changeCount,
              wasActivated: stateTransition === 'Suspended → Active',
              wasSuspended: stateTransition === 'Active → Suspended',
              priorityIncreased: priorityChange && updatedSchedule.priority > originalSchedule.priority,
              timingModified: changes.frequencyChanged || changes.timingChanged,
            },
            message: `Successfully updated schedule '${updatedSchedule.name}' with ${changeCount} change${changeCount !== 1 ? 's' : ''}`,
            warnings: {
              ...(stateTransition === 'Active → Suspended' ? 
                { suspended: 'Schedule is now suspended and will not execute automatically' } : {}),
              ...(stateTransition === 'Suspended → Active' ? 
                { activated: 'Schedule is now active and will begin executing automatically' } : {}),
              ...(changes.frequencyChanged ? 
                { frequencyChanged: 'Schedule frequency has changed - verify new timing meets business requirements' } : {}),
              ...(newPriorityLevel === 'High' && priorityChange ? 
                { highPriority: 'Schedule now has high priority - monitor system performance' } : {}),
            },
            recommendations: {
              ...(changes.stateChanged && updatedSchedule.state === 'Active' ? 
                { monitoring: 'Monitor the next few executions to ensure changes work as expected' } : {}),
              ...(changes.frequencyChanged || changes.timingChanged ? 
                { testing: 'Verify new schedule timing aligns with business requirements and system capacity' } : {}),
              ...(changes.priorityChanged ? 
                { priorityReview: 'Review overall schedule priorities to ensure balanced system resource usage' } : {}),
              documentation: 'Update schedule documentation to reflect the changes made',
              verification: 'Confirm that dependent processes can accommodate the schedule changes',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to update schedule: ${error}`);
        }
      },
    });
  },
});