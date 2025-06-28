import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listJobsTool = new Tool({
  name: 'list-jobs',
  description: `
List background jobs in Tableau Cloud/Server. Jobs handle long-running operations like extract refreshes, workbook publishing, and data source updates.

**Parameters:**
- \`filter\`: Filter expression to limit results (optional)
- \`pageSize\`: Number of jobs to return per page (optional, default: 100)
- \`pageNumber\`: Page number for pagination (optional, default: 1)
- \`status\`: Filter by job status (optional)
- \`jobType\`: Filter by job type (optional)

**Job Statuses:**
- \`Active\`: Currently running
- \`Success\`: Completed successfully
- \`Failed\`: Completed with errors
- \`Cancelled\`: Manually cancelled

**Common Job Types:**
- \`RefreshExtract\`: Data source refresh operations
- \`PublishWorkbook\`: Workbook publishing
- \`PublishDatasource\`: Data source publishing
- \`GenerateAlerts\`: Alert processing
- \`SubscriptionNotification\`: Subscription delivery

**Filter Examples:**
- \`status:eq:Active\`: Only running jobs
- \`type:eq:RefreshExtract\`: Only extract refresh jobs
- \`createdAt:gte:2024-01-01\`: Jobs created since date
- \`status:eq:Failed,createdAt:gte:2024-01-01\`: Recent failed jobs

**Example Usage:**
- All jobs: \`{}\`
- Active jobs only: \`{ "status": "Active" }\`
- Failed jobs: \`{ "filter": "status:eq:Failed" }\`
- Recent extract refreshes: \`{ "jobType": "RefreshExtract", "filter": "createdAt:gte:2024-01-01" }\`

**Use Cases:**
- Monitor system performance and job queues
- Troubleshoot failed operations
- Track long-running extract refreshes
- Audit system activity
- Plan maintenance windows around active jobs
`,
  paramsSchema: {
    filter: z.string().optional(),
    pageSize: z.number().min(1).max(1000).optional(),
    pageNumber: z.number().min(1).optional(),
    status: z.enum(['Active', 'Success', 'Failed', 'Cancelled']).optional(),
    jobType: z.string().optional(),
  },
  annotations: {
    title: 'List Jobs',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ filter, pageSize, pageNumber, status, jobType }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listJobsTool.logAndExecute({
      requestId,
      args: { filter, pageSize, pageNumber, status, jobType },
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
          if (status) filterParts.push(`status:eq:${status}`);
          if (jobType) filterParts.push(`type:eq:${jobType}`);
          const combinedFilter = filterParts.length > 0 ? filterParts.join(',') : undefined;
          
          const response = await restApi.jobsMethods.listJobs(restApi.siteId, combinedFilter);
          
          // Analyze job composition
          const statusCounts = response.jobs.reduce((acc, job) => {
            acc[job.status] = (acc[job.status] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          const typeCounts = response.jobs.reduce((acc, job) => {
            acc[job.type] = (acc[job.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          // Calculate job metrics
          const activeJobs = response.jobs.filter(j => j.status === 'Active');
          const failedJobs = response.jobs.filter(j => j.status === 'Failed');
          const completedJobs = response.jobs.filter(j => j.status === 'Success');
          
          // Analyze job durations for completed jobs
          const jobsWithDuration = completedJobs.filter(j => j.startedAt && j.completedAt);
          const avgDuration = jobsWithDuration.length > 0 
            ? jobsWithDuration.reduce((sum, job) => {
                const start = new Date(job.startedAt!).getTime();
                const end = new Date(job.completedAt!).getTime();
                return sum + (end - start);
              }, 0) / jobsWithDuration.length / 1000 // Convert to seconds
            : 0;
          
          // Identify long-running jobs
          const longRunningJobs = activeJobs.filter(job => {
            if (!job.startedAt) return false;
            const runTime = (new Date().getTime() - new Date(job.startedAt).getTime()) / 1000 / 60; // minutes
            return runTime > 30; // Consider jobs running > 30 min as long-running
          });
          
          return new Ok({
            success: true,
            jobs: response.jobs.map(job => ({
              id: job.id,
              type: job.type,
              status: job.status,
              priority: job.priority,
              progress: job.progress,
              title: job.title,
              subtitle: job.subtitle,
              createdAt: job.createdAt,
              startedAt: job.startedAt,
              completedAt: job.completedAt,
              workItem: job.workItem,
              notes: job.notes,
            })),
            pagination: response.pagination ? {
              currentPage: response.pagination.pageNumber,
              pageSize: response.pagination.pageSize,
              totalAvailable: response.pagination.totalAvailable,
              totalPages: Math.ceil(response.pagination.totalAvailable / response.pagination.pageSize),
            } : undefined,
            summary: {
              totalJobs: response.jobs.length,
              activeJobs: activeJobs.length,
              completedJobs: completedJobs.length,
              failedJobs: failedJobs.length,
              cancelledJobs: statusCounts.Cancelled || 0,
              longRunningJobs: longRunningJobs.length,
            },
            analysis: {
              statusBreakdown: statusCounts,
              typeBreakdown: typeCounts,
              averageDurationSeconds: Math.round(avgDuration),
              systemLoad: (() => {
                if (activeJobs.length > 10) return 'High';
                if (activeJobs.length > 5) return 'Medium';
                return 'Low';
              })(),
              hasFilters: !!(filter || status || jobType),
            },
            details: {
              oldestActiveJob: activeJobs.length > 0 
                ? activeJobs.reduce((oldest, job) => 
                    new Date(job.createdAt) < new Date(oldest.createdAt) ? job : oldest
                  )
                : null,
              recentFailures: failedJobs.slice(0, 5).map(job => ({
                id: job.id,
                type: job.type,
                title: job.title,
                createdAt: job.createdAt,
                notes: job.notes,
              })),
            },
            message: `Found ${response.jobs.length} jobs${combinedFilter ? ` matching filter criteria` : ''}`,
            warnings: {
              ...(longRunningJobs.length > 0 ? 
                { longRunning: `${longRunningJobs.length} jobs have been running for over 30 minutes` } : {}),
              ...(failedJobs.length > 0 ? 
                { failures: `${failedJobs.length} jobs have failed - check logs for details` } : {}),
              ...(activeJobs.length > 10 ? 
                { highLoad: 'High number of active jobs may indicate system performance issues' } : {}),
            },
            recommendations: {
              ...(longRunningJobs.length > 0 ? 
                { investigation: 'Investigate long-running jobs for potential issues or cancellation' } : {}),
              ...(failedJobs.length > 0 ? 
                { troubleshooting: 'Review failed job details and logs to identify recurring issues' } : {}),
              monitoring: 'Use job management tools to cancel problematic jobs or monitor progress',
              performance: 'Consider scheduling heavy operations during off-peak hours',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to list jobs: ${error}`);
        }
      },
    });
  },
});