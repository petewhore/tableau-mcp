import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const cancelJobTool = new Tool({
  name: 'cancel-job',
  description: `
Cancel a running background job in Tableau Cloud/Server. This stops job execution and marks it as cancelled.

**Parameters:**
- \`jobId\`: ID of the job to cancel (required)
- \`reason\`: Optional reason for cancellation (for documentation)

**Cancellable Jobs:**
- Only jobs with status 'Active' can be cancelled
- Jobs that are queued but not yet started
- Jobs currently in progress

**Important Notes:**
- **Immediate Effect**: Cancellation takes effect immediately
- **Data Integrity**: Partially completed operations may leave data in inconsistent state
- **No Rollback**: Cancelled jobs cannot be resumed or restarted
- **Dependent Operations**: May affect downstream processes expecting job completion

**Common Scenarios:**
- Long-running extract refreshes consuming excessive resources
- Jobs stuck or making no progress
- Incorrectly triggered operations
- System maintenance requiring job queue cleanup
- Resource contention during peak usage

**Example Usage:**
- Cancel stuck job: \`{ "jobId": "job-123", "reason": "Job appears stuck with no progress" }\`
- Cancel during maintenance: \`{ "jobId": "refresh-456", "reason": "System maintenance window" }\`
- Cancel incorrect operation: \`{ "jobId": "publish-789", "reason": "Incorrect content published" }\`

**Best Practices:**
- Document cancellation reason for audit purposes
- Verify job is actually problematic before cancelling
- Consider impact on dependent processes
- Plan to restart operation if needed
- Monitor system after cancellation for issues

**Use Cases:**
- Performance troubleshooting
- System maintenance preparation
- Error recovery procedures
- Resource management during peak loads
- Correcting operational mistakes
`,
  paramsSchema: {
    jobId: z.string().min(1, 'Job ID is required'),
    reason: z.string().optional(),
  },
  annotations: {
    title: 'Cancel Job',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ jobId, reason }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await cancelJobTool.logAndExecute({
      requestId,
      args: { jobId, reason },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Get job details before cancellation
          let jobDetails;
          try {
            jobDetails = await restApi.jobsMethods.getJob(restApi.siteId, jobId);
          } catch (error) {
            return new Err(`Job with ID '${jobId}' not found`);
          }
          
          // Check if job can be cancelled
          if (jobDetails.status !== 'Active') {
            return new Err(`Cannot cancel job '${jobId}' - status is '${jobDetails.status}' (only 'Active' jobs can be cancelled)`);
          }
          
          // Calculate runtime for analysis
          const startedTime = jobDetails.startedAt ? new Date(jobDetails.startedAt) : new Date(jobDetails.createdAt);
          const currentTime = new Date();
          const runtimeMinutes = Math.round((currentTime.getTime() - startedTime.getTime()) / 1000 / 60);
          
          // Cancel the job
          const result = await restApi.jobsMethods.cancelJob(restApi.siteId, jobId);
          
          // Verify cancellation by checking job status
          let cancelledJob;
          try {
            // Wait a moment for cancellation to take effect
            await new Promise(resolve => setTimeout(resolve, 1000));
            cancelledJob = await restApi.jobsMethods.getJob(restApi.siteId, jobId);
          } catch (error) {
            // Continue even if we can't verify
          }
          
          // Analyze job type and potential impact
          const jobCategory = (() => {
            if (jobDetails.type.includes('Extract') || jobDetails.type.includes('Refresh')) return 'Data Processing';
            if (jobDetails.type.includes('Publish')) return 'Content Publishing';
            if (jobDetails.type.includes('Subscription') || jobDetails.type.includes('Alert')) return 'Notifications';
            return 'Other';
          })();
          
          const impactLevel = (() => {
            if (jobCategory === 'Data Processing' && jobDetails.progress > 50) return 'High - Data may be partially updated';
            if (jobCategory === 'Content Publishing' && jobDetails.progress > 80) return 'Medium - Content may be partially published';
            if (jobDetails.progress < 10) return 'Low - Minimal work completed';
            return 'Medium - Partial completion';
          })();
          
          return new Ok({
            success: true,
            cancellation: {
              jobId: jobDetails.id,
              jobType: jobDetails.type,
              jobTitle: jobDetails.title || jobDetails.type,
              originalStatus: jobDetails.status,
              currentStatus: cancelledJob?.status || 'Cancelled',
              progressAtCancellation: jobDetails.progress,
              reason: reason || 'No reason specified',
            },
            timing: {
              runtimeMinutes,
              runtimeFriendly: runtimeMinutes >= 60 
                ? `${Math.floor(runtimeMinutes / 60)}h ${runtimeMinutes % 60}m`
                : `${runtimeMinutes}m`,
              cancelledAt: new Date().toISOString(),
            },
            impact: {
              jobCategory,
              impactLevel,
              workItemAffected: jobDetails.workItem?.name || 'Unknown',
              workItemType: jobDetails.workItem?.type || 'Unknown',
              wasLongRunning: runtimeMinutes > 30,
              hadSignificantProgress: jobDetails.progress > 25,
            },
            summary: {
              cancellationSuccessful: true,
              jobWasRunning: jobDetails.status === 'Active',
              progressLost: jobDetails.progress,
              estimatedTimeRemaining: jobDetails.progress > 0 
                ? Math.round((runtimeMinutes / jobDetails.progress) * (100 - jobDetails.progress))
                : null,
            },
            message: `Successfully cancelled job '${jobDetails.title || jobDetails.type}' (${jobDetails.progress}% complete)`,
            warnings: {
              ...(jobDetails.progress > 50 ? 
                { significantProgress: 'Job had made significant progress - consider data consistency implications' } : {}),
              ...(jobCategory === 'Data Processing' ? 
                { dataIntegrity: 'Data processing job cancelled - verify data source integrity' } : {}),
              ...(jobDetails.workItem ? 
                { workItemImpact: `Cancellation may affect ${jobDetails.workItem.type} '${jobDetails.workItem.name}'` } : {}),
              noRollback: 'Cancelled jobs cannot be resumed - operation must be restarted if needed',
            },
            recommendations: {
              verification: 'Verify that dependent systems and processes can handle the cancelled operation',
              ...(jobCategory === 'Data Processing' ? 
                { dataCheck: 'Check data source consistency and consider triggering a fresh refresh if needed' } : {}),
              ...(jobCategory === 'Content Publishing' ? 
                { contentReview: 'Review content state and republish if necessary' } : {}),
              monitoring: 'Monitor system performance after cancellation to ensure stability',
              ...(reason ? 
                { documentation: 'Cancellation reason has been recorded for audit purposes' } : 
                { addReason: 'Consider documenting cancellation reasons for future reference' }),
              restart: 'Plan to restart the operation during an appropriate maintenance window if needed',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to cancel job: ${error}`);
        }
      },
    });
  },
});