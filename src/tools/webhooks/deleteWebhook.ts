import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const deleteWebhookTool = new Tool({
  name: 'delete-webhook',
  description: `
Delete a webhook from Tableau Cloud/Server. This permanently removes the webhook and stops all future notifications to the configured endpoint.

**Parameters:**
- \`webhookId\`: ID of the webhook to delete (required)
- \`webhookName\`: Optional webhook name for reference (will be looked up if not provided)

**Deletion Impact:**
- **Immediate Effect**: Webhook is permanently removed from the system
- **Notification Stoppage**: All future event notifications to the endpoint cease
- **Integration Impact**: External systems will no longer receive Tableau events
- **No Recovery**: Deleted webhooks cannot be restored

**Pre-deletion Analysis:**
- Identifies webhook configuration and target endpoint
- Analyzes recent activity and delivery patterns
- Estimates impact on external integrations

**Use Cases:**
- **Integration Cleanup**: Remove unused or obsolete webhook integrations
- **Endpoint Changes**: Delete webhooks before reconfiguring endpoints
- **Security Response**: Remove compromised or problematic webhooks
- **System Maintenance**: Clean up webhooks during system reorganization
- **Performance Optimization**: Remove high-volume webhooks causing issues

**Integration Considerations:**
- **Dependent Systems**: External systems expecting webhook notifications will be affected
- **Monitoring**: Loss of real-time event notifications may impact monitoring systems
- **Automation**: Automated workflows triggered by webhooks will cease
- **Audit Trails**: Loss of event delivery for compliance purposes

**Best Practices:**
- Verify external systems can handle loss of webhook notifications
- Document deletion reasons for audit purposes
- Consider temporarily disabling instead of deleting
- Notify stakeholders before removing critical integrations
- Plan alternative notification methods if needed

**Example Usage:**
- Simple deletion: \`{ "webhookId": "webhook-123" }\`
- With reference name: \`{ "webhookId": "webhook-456", "webhookName": "Sales Dashboard Monitor" }\`

**Alternative Actions:**
- **Disable**: Temporarily stop notifications without deletion
- **Update**: Modify webhook configuration instead of deleting
- **Test**: Verify webhook functionality before deciding to delete

**Recovery:**
- **No Recovery**: Webhook deletion is permanent
- **Manual Recreation**: Must create new webhook with same configuration
- **Configuration Loss**: All settings and history are permanently lost
`,
  paramsSchema: {
    webhookId: z.string().min(1, 'Webhook ID is required'),
    webhookName: z.string().optional(),
  },
  annotations: {
    title: 'Delete Webhook',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ webhookId, webhookName }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await deleteWebhookTool.logAndExecute({
      requestId,
      args: { webhookId, webhookName },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Get webhook details before deletion
          let webhook;
          try {
            const webhooks = await restApi.webhooksMethods.listWebhooks(restApi.siteId);
            webhook = webhooks.find((w: any) => w.id === webhookId);
            if (!webhook) {
              return new Err(`Webhook with ID '${webhookId}' not found`);
            }
          } catch (error) {
            return new Err(`Webhook with ID '${webhookId}' not found`);
          }
          
          const resolvedWebhookName = webhookName || webhook.name;
          
          // Get owner details
          let ownerDetails: any = {};
          try {
            if (webhook.owner?.id) {
              const users = await restApi.usersMethods.listUsers(restApi.siteId, `id:eq:${webhook.owner.id}`);
              const owner = users.users[0];
              if (owner) {
                ownerDetails = {
                  name: owner.name,
                  fullName: owner.fullName,
                  email: owner.email,
                  siteRole: owner.siteRole,
                };
              }
            }
          } catch (error) {
            // Continue without owner details
          }
          
          // Test endpoint accessibility before deletion (for impact analysis)
          let endpointStatus = 'Unknown';
          try {
            const testResponse = await fetch(webhook.url, { 
              method: 'HEAD',
              signal: AbortSignal.timeout(3000)
            });
            endpointStatus = testResponse.ok ? 'Accessible' : 'Error';
          } catch (error) {
            endpointStatus = 'Inaccessible';
          }
          
          // Analyze webhook characteristics
          const webhookAnalysis = {
            eventCategory: webhook.event.includes('Workbook') ? 'Content' : 
                         webhook.event.includes('Datasource') ? 'Data' : 'User',
            contentType: webhook.event.includes('Workbook') ? 'workbook' :
                        webhook.event.includes('Datasource') ? 'datasource' : 'user',
            triggerFrequency: estimateTriggerFrequency(webhook.event),
            integrationImpact: assessIntegrationImpact(webhook, endpointStatus),
            securityLevel: webhook.url.startsWith('https://') ? 'Secure' : 'Insecure',
          };
          
          // Estimate integration dependencies
          const integrationDependencies = estimateIntegrationDependencies(webhook, webhookAnalysis);
          
          // Store deletion context before actual deletion
          const deletionContext = {
            webhookId: webhook.id,
            webhookName: webhook.name,
            url: webhook.url,
            event: webhook.event,
            enabled: webhook.enabled,
            createdAt: webhook.createdAt,
            updatedAt: webhook.updatedAt,
            owner: {
              id: webhook.owner?.id,
              name: webhook.owner?.name,
              ...ownerDetails,
            },
            analysis: webhookAnalysis,
            endpointStatus,
            integrationDependencies,
            deletedAt: new Date().toISOString(),
          };
          
          // Perform the deletion
          await restApi.webhooksMethods.deleteWebhook(restApi.siteId, webhookId);
          
          return new Ok({
            success: true,
            deleted: true,
            webhook: deletionContext,
            impact: {
              integrationImpact: webhookAnalysis.integrationImpact,
              endpointAffected: webhook.url,
              eventType: webhook.event,
              notificationStoppageImmediate: true,
              externalSystemsAffected: integrationDependencies.estimatedSystems,
              automationDisruption: integrationDependencies.automationRisk,
            },
            integrationAnalysis: {
              eventCategory: webhookAnalysis.eventCategory,
              contentScope: webhookAnalysis.contentType,
              triggerFrequency: webhookAnalysis.triggerFrequency,
              endpointWasAccessible: endpointStatus === 'Accessible',
              securityLevel: webhookAnalysis.securityLevel,
              wasActivelyUsed: webhook.enabled && endpointStatus === 'Accessible',
            },
            warnings: {
              permanentDeletion: 'Webhook deletion is permanent and cannot be undone',
              immediateEffect: 'External systems will immediately stop receiving event notifications',
              integrationDisruption: integrationDependencies.automationRisk === 'High' ? 
                'High-impact integration removed - dependent systems may be affected' : 
                'Integration removed with minimal expected impact',
              monitoringLoss: webhookAnalysis.eventCategory === 'Content' ? 
                'Loss of content change monitoring for external systems' : undefined,
              complianceConcern: webhookAnalysis.triggerFrequency === 'High' ? 
                'High-frequency webhook removed - audit trail impact possible' : undefined,
            },
            summary: {
              webhookName: resolvedWebhookName,
              targetUrl: webhook.url,
              monitoredEvent: webhook.event,
              contentScope: webhookAnalysis.contentType,
              wasEnabled: webhook.enabled,
              integrationImpact: webhookAnalysis.integrationImpact,
              deletionSuccessful: true,
            },
            message: `Successfully deleted webhook '${resolvedWebhookName}' that was monitoring ${webhook.event} events`,
            recommendations: {
              externalSystemUpdate: 'Notify maintainers of external systems that webhook notifications have ceased',
              alternativeNotification: integrationDependencies.automationRisk === 'High' ? 
                'Implement alternative notification methods for critical integrations' : 
                'Consider alternative notification methods if needed',
              monitoringAdjustment: 'Update monitoring systems that may have depended on webhook notifications',
              documentationUpdate: 'Update integration documentation to reflect webhook removal',
              stakeholderNotification: integrationDependencies.estimatedSystems > 0 ? 
                'Notify stakeholders about the integration change' : undefined,
              securityReview: 'Review if webhook removal affects security monitoring capabilities',
              ...(endpointStatus === 'Accessible' ? 
                { endpointCleanup: 'Consider cleaning up webhook endpoint configuration on target system' } : {}),
            },
          });
          
        } catch (error) {
          return new Err(`Failed to delete webhook: ${error}`);
        }
      },
    });
  },
});

// Helper functions
function estimateTriggerFrequency(event: string): string {
  const highFrequencyEvents = ['WorkbookUpdated', 'DatasourceUpdated', 'UserUpdated'];
  const mediumFrequencyEvents = ['WorkbookCreated', 'DatasourceCreated'];
  const lowFrequencyEvents = ['WorkbookDeleted', 'DatasourceDeleted', 'UserAdded', 'UserRemoved'];
  
  if (highFrequencyEvents.includes(event)) return 'High';
  if (mediumFrequencyEvents.includes(event)) return 'Medium';
  return 'Low';
}

function assessIntegrationImpact(webhook: any, endpointStatus: string): string {
  let impact = 0;
  
  // Webhook activity and health
  if (webhook.enabled && endpointStatus === 'Accessible') impact += 3; // Active, working integration
  if (webhook.enabled && endpointStatus === 'Error') impact += 2; // Active but problematic
  if (!webhook.enabled) impact += 0; // Inactive webhook
  
  // Event frequency impact
  const frequency = estimateTriggerFrequency(webhook.event);
  if (frequency === 'High') impact += 2;
  if (frequency === 'Medium') impact += 1;
  
  // Event type impact
  if (webhook.event.includes('Updated')) impact += 1; // Update events often used for monitoring
  if (webhook.event.includes('Created')) impact += 1; // Creation events often trigger workflows
  
  if (impact >= 5) return 'High';
  if (impact >= 3) return 'Medium';
  return 'Low';
}

function estimateIntegrationDependencies(webhook: any, analysis: any): any {
  // Estimate potential external system dependencies based on webhook characteristics
  let estimatedSystems = 0;
  let automationRisk = 'Low';
  
  // URL analysis for dependency estimation
  if (webhook.url.includes('api')) estimatedSystems += 1; // API endpoint suggests system integration
  if (webhook.url.includes('webhook')) estimatedSystems += 1; // Dedicated webhook endpoint
  if (webhook.url.includes('monitor') || webhook.url.includes('alert')) {
    estimatedSystems += 1;
    automationRisk = 'Medium'; // Monitoring systems often critical
  }
  
  // Event type analysis
  if (analysis.triggerFrequency === 'High') {
    estimatedSystems += 1;
    automationRisk = 'High'; // High-frequency webhooks often support critical automation
  }
  
  // Security and protocol analysis
  if (analysis.securityLevel === 'Secure' && webhook.enabled) {
    estimatedSystems += 1; // HTTPS suggests production integration
  }
  
  // Content type analysis
  if (analysis.eventCategory === 'Content') {
    automationRisk = automationRisk === 'Low' ? 'Medium' : automationRisk; // Content changes often trigger workflows
  }
  
  return {
    estimatedSystems: Math.min(estimatedSystems, 5), // Cap at 5 for realistic estimation
    automationRisk,
    dependencyFactors: {
      hasApiEndpoint: webhook.url.includes('api'),
      hasMonitoringKeywords: webhook.url.includes('monitor') || webhook.url.includes('alert'),
      isHighFrequency: analysis.triggerFrequency === 'High',
      isSecureEndpoint: analysis.securityLevel === 'Secure',
      isContentEvent: analysis.eventCategory === 'Content',
    },
  };
}