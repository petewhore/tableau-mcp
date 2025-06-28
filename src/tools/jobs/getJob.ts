import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const getJobTool = new Tool({
  name: 'get-job',
  description: `
Get detailed information about a specific background job in Tableau Cloud/Server. This provides real-time status, progress, and diagnostic information.

**Parameters:**
- \`jobId\`: ID of the job to retrieve (required)

**Job Information Includes:**
- **Status**: Current execution state (Active, Success, Failed, Cancelled)
- **Progress**: Completion percentage (0-100)
- **Timing**: Creation, start, and completion timestamps
- **Work Item**: Details about the content being processed
- **Error Information**: Notes and error messages for troubleshooting

**Job Statuses:**
- \`Active\`: Currently running - check progress for completion estimate
- \`Success\`: Completed successfully
- \`Failed\`: Completed with errors - check notes for details
- \`Cancelled\`: Manually cancelled before completion

**Progress Tracking:**
- 0%: Job queued, not yet started
- 1-99%: In progress, percentage indicates completion
- 100%: Processing complete (may still be finalizing)

**Example Usage:**
- Check job status: \`{ "jobId": "job-123" }\`
- Monitor extract refresh: \`{ "jobId": "refresh-456" }\`
- Investigate failed job: \`{ "jobId": "failed-789" }\`

**Use Cases:**
- Monitor long-running operations
- Troubleshoot failed jobs
- Track extract refresh progress
- Verify job completion
- Get error details for debugging
- Plan dependent operations
`,
  paramsSchema: {
    jobId: z.string().min(1, 'Job ID is required'),
  },
  annotations: {
    title: 'Get Job Details',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ jobId }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await getJobTool.logAndExecute({
      requestId,
      args: { jobId },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          const job = await restApi.jobsMethods.getJob(restApi.siteId, jobId);
          
          // Calculate timing information
          const createdTime = new Date(job.createdAt);
          const startedTime = job.startedAt ? new Date(job.startedAt) : null;
          const completedTime = job.completedAt ? new Date(job.completedAt) : null;
          const currentTime = new Date();
          
          // Calculate durations in seconds
          const queueTime = startedTime 
            ? Math.round((startedTime.getTime() - createdTime.getTime()) / 1000)
            : Math.round((currentTime.getTime() - createdTime.getTime()) / 1000);
          
          const executionTime = startedTime 
            ? completedTime 
              ? Math.round((completedTime.getTime() - startedTime.getTime()) / 1000)
              : Math.round((currentTime.getTime() - startedTime.getTime()) / 1000)
            : 0;
          
          const totalTime = completedTime 
            ? Math.round((completedTime.getTime() - createdTime.getTime()) / 1000)
            : Math.round((currentTime.getTime() - createdTime.getTime()) / 1000);
          
          // Determine job health and performance
          const isLongRunning = job.status === 'Active' && executionTime > 1800; // 30 minutes
          const isStalled = job.status === 'Active' && job.progress === 0 && executionTime > 300; // 5 minutes
          const isSlowProgress = job.status === 'Active' && job.progress > 0 && (executionTime / job.progress) > 60; // >1 min per 1%
          
          // Analyze job type and work item
          const jobCategory = (() => {
            if (job.type.includes('Extract') || job.type.includes('Refresh')) return 'Data Processing';
            if (job.type.includes('Publish')) return 'Content Publishing';
            if (job.type.includes('Subscription') || job.type.includes('Alert')) return 'Notifications';
            if (job.type.includes('Backup') || job.type.includes('Restore')) return 'System Maintenance';
            return 'Other';
          })();
          
          return new Ok({
            success: true,
            job: {
              id: job.id,
              type: job.type,
              status: job.status,
              priority: job.priority,
              progress: job.progress,
              title: job.title || `${job.type} Job`,
              subtitle: job.subtitle,
              createdAt: job.createdAt,
              startedAt: job.startedAt,
              completedAt: job.completedAt,
              notes: job.notes || [],
              workItem: job.workItem,
            },
            timing: {
              queueTimeSeconds: queueTime,
              executionTimeSeconds: executionTime,
              totalTimeSeconds: totalTime,
              queueTimeFriendly: `${Math.floor(queueTime / 60)}m ${queueTime % 60}s`,
              executionTimeFriendly: `${Math.floor(executionTime / 60)}m ${executionTime % 60}s`,
              totalTimeFriendly: `${Math.floor(totalTime / 60)}m ${totalTime % 60}s`,
            },
            analysis: {
              jobCategory,
              isRunning: job.status === 'Active',
              isCompleted: ['Success', 'Failed', 'Cancelled'].includes(job.status),
              hasStarted: !!job.startedAt,
              hasWorkItem: !!job.workItem,
              hasErrors: job.status === 'Failed' || (job.notes && job.notes.length > 0),
              estimatedCompletion: job.status === 'Active' && job.progress > 0 
                ? new Date(currentTime.getTime() + (executionTime / job.progress * (100 - job.progress) * 1000)).toISOString()
                : null,
            },
            performance: {
              isLongRunning,
              isStalled,
              isSlowProgress,
              progressRate: job.status === 'Active' && executionTime > 0 ? job.progress / (executionTime / 60) : 0, // % per minute
              priorityLevel: job.priority >= 70 ? 'High' : job.priority >= 40 ? 'Medium' : 'Low',
            },
            summary: {
              currentStatus: job.status,
              progressPercentage: job.progress,
              hasIssues: isLongRunning || isStalled || isSlowProgress || job.status === 'Failed',
              workItemName: job.workItem?.name || 'Unknown',
              workItemType: job.workItem?.type || 'Unknown',
            },
            message: `Job '${job.title || job.type}' is ${job.status.toLowerCase()}${job.status === 'Active' ? ` (${job.progress}% complete)` : ''}`,
            warnings: {
              ...(isLongRunning ? 
                { longRunning: `Job has been running for ${Math.floor(executionTime / 60)} minutes - consider investigation` } : {}),
              ...(isStalled ? 
                { stalled: 'Job appears stalled - no progress for extended period' } : {}),
              ...(isSlowProgress ? 
                { slowProgress: 'Job is progressing slowly - may indicate performance issues' } : {}),
              ...(job.status === 'Failed' ? 
                { failed: 'Job failed - check notes for error details' } : {}),
              ...(job.notes && job.notes.length > 0 ? 
                { hasNotes: 'Job has notes/warnings - review for important information' } : {}),
            },
            recommendations: {
              ...(isLongRunning ? 
                { considerCancellation: 'Consider cancelling if job is taking unusually long' } : {}),
              ...(job.status === 'Failed' ? 
                { troubleshoot: 'Review job notes and system logs to identify failure cause' } : {}),
              ...(job.status === 'Active' ? 
                { monitoring: 'Continue monitoring progress or use wait-for-job tool for completion' } : {}),
              ...(job.status === 'Success' ? 
                { verification: 'Verify that the intended operation completed as expected' } : {}),
            },
          });
          
        } catch (error) {
          return new Err(`Failed to get job details: ${error}`);
        }
      },
    });
  },
});