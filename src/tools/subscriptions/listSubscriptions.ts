import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listSubscriptionsTool = new Tool({
  name: 'list-subscriptions',
  description: `
List subscriptions in Tableau Cloud/Server. Subscriptions allow users to receive scheduled email or webhook notifications for workbook views, data sources, or other content.

**Parameters:**
- \`userId\`: Filter subscriptions for a specific user (optional)
- \`contentType\`: Filter by content type - workbook, view, or datasource (optional)
- \`contentId\`: Filter subscriptions for specific content (optional)
- \`includeDetails\`: Include detailed subscription configuration (optional, default: true)
- \`scheduleId\`: Filter by specific schedule (optional)

**Subscription Types:**
- **View Subscriptions**: Email delivery of workbook views/dashboards
- **Data Source Subscriptions**: Notifications about data source updates
- **Workbook Subscriptions**: Notifications about workbook changes

**Delivery Options:**
- **Email**: PDF, PNG, or CSV format delivery via email
- **Webhook**: HTTP POST notifications to external systems
- **Tableau Mobile**: Push notifications to mobile devices

**Schedule Analysis:**
- **Frequency**: Daily, weekly, monthly, or custom schedules
- **Time Zones**: Schedule timing and timezone handling
- **Execution Status**: Last run status and next scheduled run

**Subscription States:**
- **Active**: Subscription is running and delivering content
- **Suspended**: Temporarily disabled (often due to delivery failures)
- **Disabled**: Manually disabled by user or administrator

**Example Usage:**
- List all subscriptions: \`{}\`
- User subscriptions: \`{ "userId": "user-123" }\`
- Content subscriptions: \`{ "contentType": "workbook", "contentId": "wb-456" }\`
- Schedule subscriptions: \`{ "scheduleId": "schedule-789" }\`
- Detailed view: \`{ "userId": "user-123", "includeDetails": true }\`

**Use Cases:**
- **Subscription Management**: Review and manage user subscriptions
- **Performance Analysis**: Identify high-volume subscription schedules
- **Troubleshooting**: Investigate subscription delivery issues
- **Compliance**: Audit who receives what content and when
- **Resource Planning**: Understand subscription load on server resources

**Performance Insights:**
- Identifies subscriptions that may impact server performance
- Highlights high-frequency schedules and large content deliveries
- Provides recommendations for optimizing subscription efficiency
`,
  paramsSchema: {
    userId: z.string().optional(),
    contentType: z.enum(['workbook', 'view', 'datasource']).optional(),
    contentId: z.string().optional(),
    includeDetails: z.boolean().optional(),
    scheduleId: z.string().optional(),
  },
  annotations: {
    title: 'List Subscriptions',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ 
    userId, 
    contentType, 
    contentId, 
    includeDetails = true, 
    scheduleId 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listSubscriptionsTool.logAndExecute({
      requestId,
      args: { userId, contentType, contentId, includeDetails, scheduleId },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Get subscriptions with optional filtering
          let filter = '';
          const filters = [];
          
          if (userId) {
            filters.push(`userId:eq:${userId}`);
          }
          if (contentId) {
            filters.push(`contentId:eq:${contentId}`);
          }
          if (scheduleId) {
            filters.push(`scheduleId:eq:${scheduleId}`);
          }
          
          if (filters.length > 0) {
            filter = filters.join(',');
          }
          
          const subscriptionsResponse = await restApi.viewsMethods.listSubscriptions(restApi.siteId, filter);
          const subscriptions = subscriptionsResponse.subscriptions || [];
          
          if (subscriptions.length === 0) {
            return new Ok({
              success: true,
              subscriptions: [],
              statistics: {
                totalSubscriptions: 0,
                activeSubscriptions: 0,
                suspendedSubscriptions: 0,
                disabledSubscriptions: 0,
              },
              message: 'No subscriptions found matching the specified criteria',
            });
          }
          
          // Process and enhance subscription data
          const processedSubscriptions = await Promise.all(subscriptions.map(async (subscription: any) => {
            let enhancedDetails: any = {};
            
            if (includeDetails) {
              try {
                // Get user details
                if (subscription.user?.id) {
                  const users = await restApi.usersMethods.listUsers(restApi.siteId, `id:eq:${subscription.user.id}`);
                  const user = users.users[0];
                  if (user) {
                    enhancedDetails.userDetails = {
                      name: user.name,
                      fullName: user.fullName,
                      email: user.email,
                      siteRole: user.siteRole,
                    };
                  }
                }
                
                // Get content details
                if (subscription.content?.id && subscription.content?.type) {
                  try {
                    switch (subscription.content.type.toLowerCase()) {
                      case 'workbook':
                        const workbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, subscription.content.id);
                        enhancedDetails.contentDetails = {
                          name: workbook.name,
                          projectName: workbook.project?.name,
                          size: workbook.size,
                          viewCount: workbook.views?.length || 0,
                        };
                        break;
                      case 'view':
                        const view = await restApi.viewsMethods.getView(restApi.siteId, subscription.content.id);
                        enhancedDetails.contentDetails = {
                          name: view.name,
                          workbookName: view.workbook?.name,
                          projectName: view.project?.name,
                        };
                        break;
                      case 'datasource':
                        const datasource = await restApi.datasourcesMethods.getDatasource(restApi.siteId, subscription.content.id);
                        enhancedDetails.contentDetails = {
                          name: datasource.name,
                          type: datasource.type,
                          projectName: datasource.project?.name,
                          size: datasource.size,
                          hasExtracts: datasource.hasExtracts,
                        };
                        break;
                    }
                  } catch (error) {
                    // Continue without content details
                  }
                }
                
                // Get schedule details
                if (subscription.schedule?.id) {
                  try {
                    const schedule = await restApi.schedulesMethods.getSchedule(restApi.siteId, subscription.schedule.id);
                    enhancedDetails.scheduleDetails = {
                      name: schedule.name,
                      type: schedule.type,
                      frequency: schedule.frequency,
                      nextRunAt: schedule.nextRunAt,
                      state: schedule.state,
                    };
                  } catch (error) {
                    // Continue without schedule details
                  }
                }
              } catch (error) {
                // Continue without enhanced details
              }
            }
            
            // Analyze subscription characteristics
            const subscriptionState = subscription.suspended ? 'Suspended' : 
                                   subscription.enabled === false ? 'Disabled' : 'Active';
            
            const deliveryFormat = subscription.format || 'PDF';
            const hasAttachments = subscription.attachImage || subscription.attachPdf;
            
            // Estimate delivery impact
            const deliveryImpact = (() => {
              let impact = 0;
              if (deliveryFormat === 'PDF') impact += 2;
              if (hasAttachments) impact += 1;
              if (enhancedDetails.contentDetails?.size > 10000000) impact += 2; // >10MB
              if (enhancedDetails.scheduleDetails?.frequency === 'Hourly') impact += 3;
              if (enhancedDetails.scheduleDetails?.frequency === 'Daily') impact += 1;
              
              if (impact >= 5) return 'High';
              if (impact >= 3) return 'Medium';
              return 'Low';
            })();
            
            return {
              id: subscription.id,
              user: {
                id: subscription.user?.id,
                name: subscription.user?.name,
                ...enhancedDetails.userDetails,
              },
              content: {
                id: subscription.content?.id,
                type: subscription.content?.type,
                name: subscription.content?.name,
                ...enhancedDetails.contentDetails,
              },
              schedule: {
                id: subscription.schedule?.id,
                name: subscription.schedule?.name,
                ...enhancedDetails.scheduleDetails,
              },
              configuration: {
                subject: subscription.subject,
                message: subscription.message,
                format: deliveryFormat,
                attachImage: subscription.attachImage,
                attachPdf: subscription.attachPdf,
                pageSizeOption: subscription.pageSizeOption,
                pageOrientation: subscription.pageOrientation,
              },
              status: {
                state: subscriptionState,
                suspended: subscription.suspended,
                enabled: subscription.enabled !== false,
                lastDelivery: subscription.lastSent,
                deliveryImpact,
              },
              analysis: {
                isHighVolume: enhancedDetails.scheduleDetails?.frequency === 'Hourly',
                isLargeContent: enhancedDetails.contentDetails?.size > 10000000,
                hasCustomization: !!(subscription.subject || subscription.message),
                deliveryComplexity: hasAttachments ? 'Complex' : 'Simple',
              },
              createdAt: subscription.createdAt,
              updatedAt: subscription.updatedAt,
            };
          }));
          
          // Calculate subscription statistics
          const statistics = {
            totalSubscriptions: processedSubscriptions.length,
            activeSubscriptions: processedSubscriptions.filter(s => s.status.state === 'Active').length,
            suspendedSubscriptions: processedSubscriptions.filter(s => s.status.state === 'Suspended').length,
            disabledSubscriptions: processedSubscriptions.filter(s => s.status.state === 'Disabled').length,
            contentTypes: {
              workbook: processedSubscriptions.filter(s => s.content.type === 'Workbook').length,
              view: processedSubscriptions.filter(s => s.content.type === 'View').length,
              datasource: processedSubscriptions.filter(s => s.content.type === 'Datasource').length,
            },
            deliveryFormats: {
              pdf: processedSubscriptions.filter(s => s.configuration.format === 'PDF').length,
              png: processedSubscriptions.filter(s => s.configuration.format === 'PNG').length,
              csv: processedSubscriptions.filter(s => s.configuration.format === 'CSV').length,
            },
            deliveryImpact: {
              high: processedSubscriptions.filter(s => s.status.deliveryImpact === 'High').length,
              medium: processedSubscriptions.filter(s => s.status.deliveryImpact === 'Medium').length,
              low: processedSubscriptions.filter(s => s.status.deliveryImpact === 'Low').length,
            },
            uniqueUsers: new Set(processedSubscriptions.map(s => s.user.id)).size,
            uniqueContent: new Set(processedSubscriptions.map(s => s.content.id)).size,
            customizedSubscriptions: processedSubscriptions.filter(s => s.analysis.hasCustomization).length,
          };
          
          // Analyze subscription health
          const healthAnalysis = {
            suspensionRate: Math.round((statistics.suspendedSubscriptions / statistics.totalSubscriptions) * 100),
            activeRate: Math.round((statistics.activeSubscriptions / statistics.totalSubscriptions) * 100),
            highImpactSubscriptions: statistics.deliveryImpact.high,
            overallHealth: (() => {
              if (statistics.suspendedSubscriptions > statistics.totalSubscriptions * 0.2) return 'Poor';
              if (statistics.suspendedSubscriptions > statistics.totalSubscriptions * 0.1) return 'Fair';
              return 'Good';
            })(),
          };
          
          return new Ok({
            success: true,
            subscriptions: processedSubscriptions,
            statistics,
            analysis: {
              health: healthAnalysis,
              performanceImpact: (() => {
                if (statistics.deliveryImpact.high > 10) return 'High';
                if (statistics.deliveryImpact.high > 5) return 'Medium';
                return 'Low';
              })(),
              diversityScore: (() => {
                const contentDiversity = Object.values(statistics.contentTypes).filter(count => count > 0).length;
                const formatDiversity = Object.values(statistics.deliveryFormats).filter(count => count > 0).length;
                return Math.round(((contentDiversity + formatDiversity) / 6) * 100);
              })(),
            },
            summary: {
              totalSubscriptions: statistics.totalSubscriptions,
              activeSubscriptions: statistics.activeSubscriptions,
              suspendedSubscriptions: statistics.suspendedSubscriptions,
              uniqueUsers: statistics.uniqueUsers,
              uniqueContent: statistics.uniqueContent,
              healthStatus: healthAnalysis.overallHealth,
              performanceImpact: statistics.deliveryImpact.high > 10 ? 'High' : 'Manageable',
            },
            message: `Found ${statistics.totalSubscriptions} subscriptions (${statistics.activeSubscriptions} active, ${statistics.suspendedSubscriptions} suspended)`,
            warnings: {
              ...(statistics.suspendedSubscriptions > 0 ? 
                { suspendedSubscriptions: `${statistics.suspendedSubscriptions} subscriptions are suspended - investigate delivery issues` } : {}),
              ...(statistics.deliveryImpact.high > 5 ? 
                { highImpact: `${statistics.deliveryImpact.high} high-impact subscriptions may affect server performance` } : {}),
              ...(healthAnalysis.overallHealth === 'Poor' ? 
                { healthConcern: 'Poor subscription health - high suspension rate indicates delivery problems' } : {}),
            },
            recommendations: {
              ...(statistics.suspendedSubscriptions > 0 ? 
                { addressSuspensions: 'Investigate and resolve issues causing subscription suspensions' } : {}),
              ...(statistics.deliveryImpact.high > 3 ? 
                { optimizeDelivery: 'Consider optimizing high-impact subscriptions to reduce server load' } : {}),
              monitoring: 'Regularly monitor subscription health and delivery success rates',
              userCommunication: 'Communicate with users about subscription best practices and limitations',
              scheduleOptimization: 'Review subscription schedules to distribute load evenly throughout the day',
              ...(statistics.customizedSubscriptions < statistics.totalSubscriptions * 0.5 ? 
                { customization: 'Encourage users to customize subscription subjects and messages for better engagement' } : {}),
            },
          });
          
        } catch (error) {
          return new Err(`Failed to list subscriptions: ${error}`);
        }
      },
    });
  },
});