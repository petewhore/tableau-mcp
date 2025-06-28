import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const deleteSubscriptionTool = new Tool({
  name: 'delete-subscription',
  description: `
Delete a subscription from Tableau Cloud/Server. This permanently removes the subscription and stops all future deliveries.

**Parameters:**
- \`subscriptionId\`: ID of the subscription to delete (required)
- \`userId\`: Optional user ID for reference (will be looked up if not provided)

**Deletion Impact:**
- **Immediate Effect**: Subscription is permanently removed from the system
- **Delivery Stoppage**: All future scheduled deliveries are cancelled
- **User Notification**: User will no longer receive the subscribed content
- **No Recovery**: Deleted subscriptions cannot be restored

**Subscription Types:**
- **View Subscriptions**: Email delivery of workbook views/dashboards
- **Data Source Subscriptions**: Notifications about data source updates
- **Workbook Subscriptions**: Notifications about workbook changes

**Pre-deletion Analysis:**
- Identifies subscription details including user, content, and schedule
- Analyzes delivery frequency and last successful delivery
- Estimates impact on user's content consumption workflow

**Use Cases:**
- **User Request**: User no longer wants to receive specific content
- **Content Removal**: Subscription cleanup after content deletion
- **Performance Optimization**: Remove high-volume subscriptions causing load
- **Compliance**: Remove subscriptions that violate data policies
- **Maintenance**: Clean up abandoned or unused subscriptions

**Best Practices:**
- Confirm with user before deleting their subscriptions
- Document deletion reasons for audit purposes
- Consider temporarily suspending instead of deleting
- Review related subscriptions that might be affected
- Notify users about alternative ways to access content

**Example Usage:**
- Simple deletion: \`{ "subscriptionId": "sub-123" }\`
- With user reference: \`{ "subscriptionId": "sub-456", "userId": "user-789" }\`

**Alternative Actions:**
- **Suspend**: Temporarily disable without deletion
- **Modify Schedule**: Change frequency instead of deleting
- **Update Content**: Change what content is delivered
- **Transfer Ownership**: Move subscription to different user

**Recovery:**
- **No Recovery**: Subscription deletion is permanent
- **Manual Recreation**: User must create new subscription manually
- **Settings Loss**: All customization and scheduling preferences are lost
`,
  paramsSchema: {
    subscriptionId: z.string().min(1, 'Subscription ID is required'),
    userId: z.string().optional(),
  },
  annotations: {
    title: 'Delete Subscription',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ subscriptionId, userId }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await deleteSubscriptionTool.logAndExecute({
      requestId,
      args: { subscriptionId, userId },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Get subscription details before deletion
          let subscription;
          try {
            const subscriptionsResponse = await restApi.viewsMethods.listSubscriptions(restApi.siteId, `id:eq:${subscriptionId}`);
            subscription = subscriptionsResponse.subscriptions?.[0];
            if (!subscription) {
              return new Err(`Subscription with ID '${subscriptionId}' not found`);
            }
          } catch (error) {
            return new Err(`Subscription with ID '${subscriptionId}' not found`);
          }
          
          // Get enhanced details about the subscription
          let userDetails: any = {};
          let contentDetails: any = {};
          let scheduleDetails: any = {};
          
          try {
            // Get user details
            if (subscription.user?.id) {
              const users = await restApi.usersMethods.listUsers(restApi.siteId, `id:eq:${subscription.user.id}`);
              const user = users.users[0];
              if (user) {
                userDetails = {
                  name: user.name,
                  fullName: user.fullName,
                  email: user.email,
                  siteRole: user.siteRole,
                };
              }
            }
            
            // Get content details
            if (subscription.content?.id && subscription.content?.type) {
              switch (subscription.content.type.toLowerCase()) {
                case 'workbook':
                  const workbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, subscription.content.id);
                  contentDetails = {
                    name: workbook.name,
                    type: 'Workbook',
                    projectName: workbook.project?.name,
                    size: workbook.size,
                    viewCount: workbook.views?.length || 0,
                  };
                  break;
                case 'view':
                  const view = await restApi.viewsMethods.getView(restApi.siteId, subscription.content.id);
                  contentDetails = {
                    name: view.name,
                    type: 'View',
                    workbookName: view.workbook?.name,
                    projectName: view.project?.name,
                  };
                  break;
                case 'datasource':
                  const datasource = await restApi.datasourcesMethods.getDatasource(restApi.siteId, subscription.content.id);
                  contentDetails = {
                    name: datasource.name,
                    type: 'Data Source',
                    projectName: datasource.project?.name,
                    dataSourceType: datasource.type,
                    hasExtracts: datasource.hasExtracts,
                  };
                  break;
              }
            }
            
            // Get schedule details
            if (subscription.schedule?.id) {
              const schedule = await restApi.schedulesMethods.getSchedule(restApi.siteId, subscription.schedule.id);
              scheduleDetails = {
                name: schedule.name,
                type: schedule.type,
                frequency: schedule.frequency,
                nextRunAt: schedule.nextRunAt,
                state: schedule.state,
              };
            }
          } catch (error) {
            // Continue with deletion even if we can't get details
          }
          
          // Analyze subscription characteristics
          const subscriptionState = subscription.suspended ? 'Suspended' : 
                                  subscription.enabled === false ? 'Disabled' : 'Active';
          
          const deliveryFormat = subscription.format || 'PDF';
          const hasCustomization = !!(subscription.subject || subscription.message);
          const hasAttachments = subscription.attachImage || subscription.attachPdf;
          
          // Calculate subscription impact
          const subscriptionImpact = (() => {
            let impact = 0;
            if (scheduleDetails.frequency === 'Hourly') impact += 3;
            if (scheduleDetails.frequency === 'Daily') impact += 2;
            if (scheduleDetails.frequency === 'Weekly') impact += 1;
            if (contentDetails.size > 10000000) impact += 2; // >10MB
            if (hasAttachments) impact += 1;
            if (hasCustomization) impact += 1;
            
            if (impact >= 5) return 'High';
            if (impact >= 3) return 'Medium';
            return 'Low';
          })();
          
          // Store deletion context before actual deletion
          const deletionContext = {
            subscriptionId: subscription.id,
            user: {
              id: subscription.user?.id,
              name: subscription.user?.name,
              ...userDetails,
            },
            content: {
              id: subscription.content?.id,
              type: subscription.content?.type,
              name: subscription.content?.name,
              ...contentDetails,
            },
            schedule: {
              id: subscription.schedule?.id,
              name: subscription.schedule?.name,
              ...scheduleDetails,
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
              subscriptionImpact,
            },
            analysis: {
              wasActive: subscriptionState === 'Active',
              hadRegularDelivery: ['Daily', 'Weekly', 'Monthly'].includes(scheduleDetails.frequency),
              wasCustomized: hasCustomization,
              wasHighVolume: scheduleDetails.frequency === 'Hourly',
            },
            createdAt: subscription.createdAt,
            updatedAt: subscription.updatedAt,
            deletedAt: new Date().toISOString(),
          };
          
          // Perform the deletion
          await restApi.viewsMethods.deleteSubscription(restApi.siteId, subscriptionId);
          
          return new Ok({
            success: true,
            deleted: true,
            subscription: deletionContext,
            impact: {
              subscriptionImpact,
              userAffected: userDetails.name || subscription.user?.name || 'Unknown',
              contentAffected: contentDetails.name || subscription.content?.name || 'Unknown',
              deliveryFrequency: scheduleDetails.frequency || 'Unknown',
              deliveryStoppedImmediately: true,
              noRecoveryPossible: true,
            },
            userImpact: {
              willStopReceiving: `${contentDetails.type || 'Content'} deliveries`,
              deliveryFormat: deliveryFormat,
              scheduledFrequency: scheduleDetails.frequency || 'Unknown',
              customizationLost: hasCustomization,
              alternativeAccess: 'User can manually access content in Tableau or create new subscription',
            },
            warnings: {
              permanentDeletion: 'Subscription deletion is permanent and cannot be undone',
              immediateEffect: 'User will immediately stop receiving scheduled deliveries',
              customizationLoss: hasCustomization ? 
                'Custom subject and message settings are permanently lost' : undefined,
              scheduleImpact: deletionContext.analysis.wasHighVolume ? 
                'High-volume subscription removed - server load will be reduced' : undefined,
            },
            summary: {
              subscriptionType: `${contentDetails.type || subscription.content?.type || 'Unknown'} subscription`,
              userAffected: userDetails.name || subscription.user?.name || 'Unknown',
              contentName: contentDetails.name || subscription.content?.name || 'Unknown',
              deliveryFrequency: scheduleDetails.frequency || 'Unknown',
              wasActive: deletionContext.analysis.wasActive,
              subscriptionImpact,
              deletionSuccessful: true,
            },
            message: `Successfully deleted subscription for ${userDetails.name || 'user'} to receive ${contentDetails.type || 'content'} '${contentDetails.name || subscription.content?.name || 'Unknown'}'`,
            recommendations: {
              userNotification: 'Notify the user that their subscription has been deleted',
              alternativeAccess: 'Inform user about alternative ways to access the content',
              ...(deletionContext.analysis.wasCustomized ? 
                { recreationGuidance: 'If user needs to recreate subscription, provide guidance on customization options' } : {}),
              ...(contentDetails.projectName ? 
                { projectAccess: `Ensure user still has access to project '${contentDetails.projectName}' for manual content access` } : {}),
              documentation: 'Document subscription deletion reason for audit purposes',
              relatedSubscriptions: 'Check if user has other subscriptions for related content',
              ...(deletionContext.analysis.wasHighVolume ? 
                { performanceNote: 'Monitor server performance improvement after removing high-volume subscription' } : {}),
            },
          });
          
        } catch (error) {
          return new Err(`Failed to delete subscription: ${error}`);
        }
      },
    });
  },
});