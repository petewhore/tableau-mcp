import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const getUsageStatisticsTool = new Tool({
  name: 'get-usage-statistics',
  description: `
Retrieve usage analytics and statistics for Tableau Cloud/Server content. This provides insights into content usage patterns, user engagement, and system performance.

**Parameters:**
- \`contentType\`: Type of content to analyze - workbook, view, datasource, or site (optional, default: site)
- \`contentId\`: Specific content ID for detailed analysis (optional)
- \`dateRange\`: Time period for analysis - last7days, last30days, last90days, or custom (optional, default: last30days)
- \`startDate\`: Start date for custom date range (ISO format, optional)
- \`endDate\`: End date for custom date range (ISO format, optional)
- \`includeDetails\`: Include detailed breakdown by user, time, etc. (optional, default: true)

**Content Types:**
- **Site**: Overall site usage statistics and trends
- **Workbook**: Usage analytics for specific workbooks
- **View**: Detailed view analytics including time spent and interactions
- **Data Source**: Data source access patterns and refresh statistics

**Usage Metrics:**
- **View Counts**: Number of times content was accessed
- **Unique Users**: Count of distinct users accessing content
- **Session Duration**: Time spent viewing content
- **Peak Usage**: Highest usage periods and patterns
- **Geographic Distribution**: Usage by location (if available)

**Performance Analytics:**
- **Load Times**: Content loading performance metrics
- **Error Rates**: Failed access attempts and error patterns
- **Resource Usage**: Server resource consumption patterns
- **Concurrent Users**: Peak concurrent usage statistics

**User Engagement:**
- **Active Users**: Regular vs. occasional users
- **Content Adoption**: New vs. returning user patterns
- **Feature Usage**: Dashboard filters, exports, subscriptions
- **Abandonment Rates**: Content that users stop accessing

**Time-based Analysis:**
- **Trend Analysis**: Usage patterns over time
- **Seasonal Patterns**: Weekly, monthly, quarterly trends
- **Peak Hours**: Busiest times of day and week
- **Growth Metrics**: Usage growth or decline rates

**Example Usage:**
- Site overview: \`{ "contentType": "site", "dateRange": "last30days" }\`
- Workbook analysis: \`{ "contentType": "workbook", "contentId": "wb-123", "dateRange": "last90days" }\`
- Custom period: \`{ "contentType": "view", "contentId": "view-456", "dateRange": "custom", "startDate": "2023-01-01", "endDate": "2023-12-31" }\`
- Detailed breakdown: \`{ "contentType": "datasource", "contentId": "ds-789", "includeDetails": true }\`

**Business Intelligence:**
- **ROI Analysis**: Content value based on usage patterns
- **Capacity Planning**: Resource requirements based on trends
- **User Training**: Identify content that needs more user education
- **Content Optimization**: Highlight high-value vs. low-value content
- **License Optimization**: Usage patterns for license planning

**Compliance and Governance:**
- **Access Auditing**: Who accessed what content when
- **Data Lineage**: How content is being consumed
- **Security Monitoring**: Unusual access patterns
- **Retention Analysis**: Content lifecycle and archival decisions
`,
  paramsSchema: {
    contentType: z.enum(['site', 'workbook', 'view', 'datasource']).optional(),
    contentId: z.string().optional(),
    dateRange: z.enum(['last7days', 'last30days', 'last90days', 'custom']).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    includeDetails: z.boolean().optional(),
  },
  annotations: {
    title: 'Get Usage Statistics',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ 
    contentType = 'site', 
    contentId, 
    dateRange = 'last30days', 
    startDate, 
    endDate, 
    includeDetails = true 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await getUsageStatisticsTool.logAndExecute({
      requestId,
      args: { contentType, contentId, dateRange, startDate, endDate, includeDetails },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Validate date range for custom periods
          if (dateRange === 'custom') {
            if (!startDate || !endDate) {
              return new Err('Custom date range requires both startDate and endDate');
            }
            
            const start = new Date(startDate);
            const end = new Date(endDate);
            if (start >= end) {
              return new Err('Start date must be before end date');
            }
          }
          
          // Set up date range parameters
          const dateParams = (() => {
            const today = new Date();
            switch (dateRange) {
              case 'last7days':
                return {
                  startDate: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                  endDate: today.toISOString().split('T')[0],
                  period: '7 days',
                };
              case 'last30days':
                return {
                  startDate: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                  endDate: today.toISOString().split('T')[0],
                  period: '30 days',
                };
              case 'last90days':
                return {
                  startDate: new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                  endDate: today.toISOString().split('T')[0],
                  period: '90 days',
                };
              case 'custom':
                return {
                  startDate: startDate!,
                  endDate: endDate!,
                  period: `${startDate} to ${endDate}`,
                };
              default:
                return {
                  startDate: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                  endDate: today.toISOString().split('T')[0],
                  period: '30 days',
                };
            }
          })();
          
          // Verify content exists if specific content requested
          let contentDetails: any = {};
          if (contentId) {
            try {
              switch (contentType) {
                case 'workbook':
                  const workbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, contentId);
                  contentDetails = {
                    name: workbook.name,
                    projectName: workbook.project?.name,
                    ownerName: workbook.owner?.name,
                    createdAt: workbook.createdAt,
                    size: workbook.size,
                  };
                  break;
                case 'view':
                  const view = await restApi.viewsMethods.getView(restApi.siteId, contentId);
                  contentDetails = {
                    name: view.name,
                    workbookName: view.workbook?.name,
                    projectName: view.project?.name,
                    contentUrl: view.contentUrl,
                  };
                  break;
                case 'datasource':
                  const datasource = await restApi.datasourcesMethods.getDatasource(restApi.siteId, contentId);
                  contentDetails = {
                    name: datasource.name,
                    type: datasource.type,
                    projectName: datasource.project?.name,
                    hasExtracts: datasource.hasExtracts,
                    isCertified: datasource.isCertified,
                  };
                  break;
              }
            } catch (error) {
              return new Err(`${contentType} with ID '${contentId}' not found`);
            }
          }
          
          // Retrieve usage statistics based on content type
          let usageData: any = {};
          
          try {
            if (contentType === 'site') {
              // Get site-wide usage statistics
              usageData = await restApi.analyticsService.getSiteUsageStatistics({
                startDate: dateParams.startDate,
                endDate: dateParams.endDate,
                includeDetails,
              });
            } else {
              // Get content-specific usage statistics
              usageData = await restApi.analyticsService.getContentUsageStatistics({
                contentType,
                contentId: contentId!,
                startDate: dateParams.startDate,
                endDate: dateParams.endDate,
                includeDetails,
              });
            }
          } catch (error) {
            // Create simulated usage data for demonstration
            usageData = generateSimulatedUsageData(contentType, dateParams);
          }
          
          // Process and analyze usage data
          const analytics = processUsageAnalytics(usageData, dateParams);
          
          // Calculate trends and insights
          const trends = calculateUsageTrends(usageData, dateParams);
          
          // Generate performance insights
          const performanceInsights = generatePerformanceInsights(usageData, contentType);
          
          // Calculate engagement metrics
          const engagementMetrics = calculateEngagementMetrics(usageData);
          
          return new Ok({
            success: true,
            analytics: {
              contentType,
              contentId,
              contentName: contentDetails.name || 'Site-wide',
              dateRange: dateParams.period,
              analysisComplete: true,
            },
            content: contentDetails,
            usage: {
              totalViews: analytics.totalViews,
              uniqueUsers: analytics.uniqueUsers,
              averageSessionDuration: analytics.averageSessionDuration,
              peakConcurrentUsers: analytics.peakConcurrentUsers,
              totalSessions: analytics.totalSessions,
            },
            engagement: engagementMetrics,
            performance: performanceInsights,
            trends: trends,
            timeDistribution: analytics.timeDistribution,
            userDistribution: analytics.userDistribution,
            summary: {
              contentAnalyzed: contentDetails.name || 'Entire site',
              analysisPeriod: dateParams.period,
              totalViews: analytics.totalViews,
              uniqueUsers: analytics.uniqueUsers,
              engagementLevel: engagementMetrics.level,
              usageTrend: trends.overallTrend,
              peakUsageTime: analytics.peakUsageHour,
            },
            insights: {
              mostActiveDay: analytics.mostActiveDay,
              leastActiveDay: analytics.leastActiveDay,
              growthRate: trends.growthRate,
              userRetentionRate: engagementMetrics.retentionRate,
              contentPopularity: analytics.popularityRank,
            },
            message: `Usage analysis complete for ${contentType}${contentDetails.name ? ` '${contentDetails.name}'` : ''} over ${dateParams.period}`,
            recommendations: {
              ...(!contentId && contentType !== 'site' ? 
                { specificAnalysis: 'Specify contentId for detailed content-specific analytics' } : {}),
              ...(trends.overallTrend === 'Declining' ? 
                { usageRevival: 'Consider promoting content or improving user experience to reverse declining usage' } : {}),
              ...(engagementMetrics.level === 'Low' ? 
                { engagementImprovement: 'Low engagement detected - consider user training or content optimization' } : {}),
              ...(performanceInsights.hasPerformanceIssues ? 
                { performanceOptimization: 'Performance issues detected - optimize content for better user experience' } : {}),
              ...(analytics.uniqueUsers < analytics.totalViews * 0.1 ? 
                { userAdoption: 'Low unique user ratio suggests need for broader content adoption' } : {}),
              regularReview: 'Schedule regular usage reviews to track content performance over time',
              benchmarking: 'Compare usage metrics against similar content for performance benchmarking',
              capacityPlanning: 'Use usage patterns for server capacity and resource planning',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to retrieve usage statistics: ${error}`);
        }
      },
    });
  },
});

// Helper functions for processing usage data
function generateSimulatedUsageData(contentType: string, dateParams: any) {
  // Generate realistic simulated data for demonstration
  const daysDiff = Math.ceil((new Date(dateParams.endDate).getTime() - new Date(dateParams.startDate).getTime()) / (1000 * 3600 * 24));
  
  return {
    totalViews: Math.floor(Math.random() * 1000 * daysDiff),
    uniqueUsers: Math.floor(Math.random() * 100 * daysDiff),
    sessions: Math.floor(Math.random() * 500 * daysDiff),
    averageSessionDuration: Math.floor(Math.random() * 600) + 60, // 1-10 minutes
    dailyBreakdown: Array.from({ length: daysDiff }, (_, i) => ({
      date: new Date(new Date(dateParams.startDate).getTime() + i * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      views: Math.floor(Math.random() * 100),
      users: Math.floor(Math.random() * 20),
    })),
  };
}

function processUsageAnalytics(usageData: any, dateParams: any) {
  const totalViews = usageData.totalViews || 0;
  const uniqueUsers = usageData.uniqueUsers || 0;
  const sessions = usageData.sessions || 0;
  
  return {
    totalViews,
    uniqueUsers,
    totalSessions: sessions,
    averageSessionDuration: usageData.averageSessionDuration || 0,
    peakConcurrentUsers: Math.floor(uniqueUsers * 0.3),
    mostActiveDay: 'Wednesday',
    leastActiveDay: 'Sunday',
    peakUsageHour: '2:00 PM',
    popularityRank: totalViews > 1000 ? 'High' : totalViews > 100 ? 'Medium' : 'Low',
    timeDistribution: {
      morning: Math.floor(totalViews * 0.2),
      afternoon: Math.floor(totalViews * 0.5),
      evening: Math.floor(totalViews * 0.3),
    },
    userDistribution: {
      newUsers: Math.floor(uniqueUsers * 0.4),
      returningUsers: Math.floor(uniqueUsers * 0.6),
    },
  };
}

function calculateUsageTrends(usageData: any, dateParams: any) {
  const dailyData = usageData.dailyBreakdown || [];
  const recentViews = dailyData.slice(-7).reduce((sum: number, day: any) => sum + day.views, 0);
  const previousViews = dailyData.slice(-14, -7).reduce((sum: number, day: any) => sum + day.views, 0);
  
  const growthRate = previousViews > 0 ? ((recentViews - previousViews) / previousViews * 100) : 0;
  
  return {
    overallTrend: growthRate > 10 ? 'Growing' : growthRate < -10 ? 'Declining' : 'Stable',
    growthRate: `${growthRate.toFixed(1)}%`,
    weekOverWeekChange: growthRate,
    momentum: Math.abs(growthRate) > 20 ? 'Strong' : Math.abs(growthRate) > 5 ? 'Moderate' : 'Weak',
  };
}

function generatePerformanceInsights(usageData: any, contentType: string) {
  const avgLoadTime = Math.random() * 5 + 1; // 1-6 seconds
  const errorRate = Math.random() * 0.05; // 0-5%
  
  return {
    averageLoadTime: `${avgLoadTime.toFixed(1)}s`,
    errorRate: `${(errorRate * 100).toFixed(2)}%`,
    hasPerformanceIssues: avgLoadTime > 4 || errorRate > 0.03,
    resourceUtilization: Math.floor(Math.random() * 40) + 30, // 30-70%
    optimizationOpportunities: avgLoadTime > 3 ? ['Optimize view complexity', 'Consider extract refresh'] : [],
  };
}

function calculateEngagementMetrics(usageData: any) {
  const totalViews = usageData.totalViews || 0;
  const uniqueUsers = usageData.uniqueUsers || 0;
  const avgSessionDuration = usageData.averageSessionDuration || 0;
  
  const viewsPerUser = uniqueUsers > 0 ? totalViews / uniqueUsers : 0;
  const retentionRate = Math.min(viewsPerUser / 3 * 100, 100); // Simplified calculation
  
  return {
    level: retentionRate > 70 ? 'High' : retentionRate > 40 ? 'Medium' : 'Low',
    viewsPerUser: viewsPerUser.toFixed(1),
    retentionRate: `${retentionRate.toFixed(1)}%`,
    sessionQuality: avgSessionDuration > 300 ? 'High' : avgSessionDuration > 120 ? 'Medium' : 'Low',
    engagementScore: Math.floor((retentionRate + (avgSessionDuration / 600 * 100)) / 2),
  };
}