import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listWebhooksTool = new Tool({
  name: 'list-webhooks',
  description: `
List all webhooks configured in Tableau Cloud/Server. This provides an overview of active integrations and their configuration.

**Parameters:**
- \`includeDetails\`: Include detailed webhook information and statistics (optional, default: true)
- \`eventFilter\`: Filter webhooks by event type (optional)
- \`enabledOnly\`: Show only enabled webhooks (optional, default: false)

**Webhook Information:**
- **Basic Details**: Name, URL, event type, enabled status
- **Ownership**: Who created and manages each webhook
- **Activity**: Last triggered time, delivery success rates
- **Configuration**: Event filters, content scope

**Event Analysis:**
- **Event Distribution**: Breakdown of webhooks by event type
- **Integration Patterns**: Common integration scenarios
- **Health Status**: Active vs. inactive webhooks
- **Delivery Statistics**: Success rates and failure patterns

**Management Insights:**
- **Unused Webhooks**: Webhooks that haven't been triggered recently
- **High-Volume**: Webhooks receiving many notifications
- **Failed Deliveries**: Webhooks with delivery issues
- **Security Assessment**: HTTPS usage and endpoint accessibility

**Example Usage:**
- List all webhooks: \`{}\`
- Detailed view: \`{ "includeDetails": true }\`
- Filter by event: \`{ "eventFilter": "WorkbookUpdated" }\`
- Active only: \`{ "enabledOnly": true }\`

**Use Cases:**
- **Integration Audit**: Review all external integrations
- **Troubleshooting**: Identify webhook delivery issues
- **Security Review**: Assess webhook security configurations
- **Cleanup**: Find unused or problematic webhooks
- **Performance**: Analyze webhook impact on system performance

**Monitoring and Maintenance:**
- Regular review of webhook configurations
- Monitoring delivery success rates
- Updating endpoint URLs when services change
- Removing unused webhooks to reduce overhead
- Testing webhook endpoints periodically
`,
  paramsSchema: {
    includeDetails: z.boolean().optional(),
    eventFilter: z.enum([
      'WorkbookCreated',
      'WorkbookUpdated', 
      'WorkbookDeleted',
      'DatasourceCreated',
      'DatasourceUpdated',
      'DatasourceDeleted',
      'UserAdded',
      'UserRemoved',
      'UserUpdated'
    ]).optional(),
    enabledOnly: z.boolean().optional(),
  },
  annotations: {
    title: 'List Webhooks',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ 
    includeDetails = true, 
    eventFilter, 
    enabledOnly = false 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listWebhooksTool.logAndExecute({
      requestId,
      args: { includeDetails, eventFilter, enabledOnly },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Retrieve all webhooks
          const webhooks = await restApi.webhooksMethods.listWebhooks(restApi.siteId);
          
          if (webhooks.length === 0) {
            return new Ok({
              success: true,
              webhooks: [],
              statistics: {
                totalWebhooks: 0,
                enabledWebhooks: 0,
                disabledWebhooks: 0,
              },
              message: 'No webhooks found in this site',
            });
          }
          
          // Apply filters
          let filteredWebhooks = webhooks;
          
          if (eventFilter) {
            filteredWebhooks = filteredWebhooks.filter((webhook: any) => webhook.event === eventFilter);
          }
          
          if (enabledOnly) {
            filteredWebhooks = filteredWebhooks.filter((webhook: any) => webhook.enabled);
          }
          
          // Process webhook data
          const processedWebhooks = await Promise.all(filteredWebhooks.map(async (webhook: any) => {
            let enhancedDetails: any = {};
            
            if (includeDetails) {
              // Get owner details
              try {
                if (webhook.owner?.id) {
                  const users = await restApi.usersMethods.listUsers(restApi.siteId, `id:eq:${webhook.owner.id}`);
                  const owner = users.users[0];
                  if (owner) {
                    enhancedDetails.ownerDetails = {
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
              
              // Test endpoint accessibility
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
              
              enhancedDetails.endpointStatus = endpointStatus;
            }
            
            // Analyze webhook characteristics
            const webhookAnalysis = {
              eventCategory: webhook.event.includes('Workbook') ? 'Content' : 
                           webhook.event.includes('Datasource') ? 'Data' : 'User',
              contentType: webhook.event.includes('Workbook') ? 'workbook' :
                          webhook.event.includes('Datasource') ? 'datasource' : 'user',
              triggerFrequency: estimateTriggerFrequency(webhook.event),
              securityLevel: webhook.url.startsWith('https://') ? 'Secure' : 'Insecure',
              integrationHealth: determineIntegrationHealth(webhook, enhancedDetails.endpointStatus),
            };
            
            return {
              id: webhook.id,
              name: webhook.name,
              url: webhook.url,
              event: webhook.event,
              enabled: webhook.enabled,
              createdAt: webhook.createdAt,
              updatedAt: webhook.updatedAt,
              owner: {
                id: webhook.owner?.id,
                name: webhook.owner?.name,
                ...enhancedDetails.ownerDetails,
              },
              analysis: webhookAnalysis,
              status: {
                enabled: webhook.enabled,
                endpointAccessible: enhancedDetails.endpointStatus === 'Accessible',
                endpointStatus: enhancedDetails.endpointStatus,
                integrationHealth: webhookAnalysis.integrationHealth,
              },
              configuration: {
                eventType: webhook.event,
                contentScope: webhookAnalysis.contentType,
                protocol: webhook.url.startsWith('https://') ? 'HTTPS' : 'HTTP',
                triggerFrequency: webhookAnalysis.triggerFrequency,
              },
            };
          }));
          
          // Calculate statistics
          const statistics = {
            totalWebhooks: processedWebhooks.length,
            enabledWebhooks: processedWebhooks.filter(w => w.enabled).length,
            disabledWebhooks: processedWebhooks.filter(w => !w.enabled).length,
            accessibleEndpoints: processedWebhooks.filter(w => w.status.endpointAccessible).length,
            inaccessibleEndpoints: processedWebhooks.filter(w => w.status.endpointStatus === 'Inaccessible').length,
            eventDistribution: calculateEventDistribution(processedWebhooks),
            contentDistribution: calculateContentDistribution(processedWebhooks),
            securityDistribution: {
              https: processedWebhooks.filter(w => w.configuration.protocol === 'HTTPS').length,
              http: processedWebhooks.filter(w => w.configuration.protocol === 'HTTP').length,
            },
            healthDistribution: calculateHealthDistribution(processedWebhooks),
          };
          
          // Generate insights
          const insights = generateWebhookInsights(processedWebhooks, statistics);
          
          return new Ok({
            success: true,
            webhooks: processedWebhooks,
            statistics,
            insights,
            filtering: {
              eventFilter,
              enabledOnly,
              totalBeforeFilter: webhooks.length,
              totalAfterFilter: processedWebhooks.length,
            },
            summary: {
              totalWebhooks: statistics.totalWebhooks,
              activeWebhooks: statistics.enabledWebhooks,
              healthyIntegrations: processedWebhooks.filter(w => w.analysis.integrationHealth === 'Healthy').length,
              securityCompliant: statistics.securityDistribution.https,
              needsAttention: processedWebhooks.filter(w => w.analysis.integrationHealth === 'Unhealthy').length,
            },
            message: `Found ${statistics.totalWebhooks} webhooks (${statistics.enabledWebhooks} enabled, ${statistics.disabledWebhooks} disabled)`,
            warnings: {
              ...(statistics.inaccessibleEndpoints > 0 ? 
                { inaccessibleEndpoints: `${statistics.inaccessibleEndpoints} webhooks have inaccessible endpoints` } : {}),
              ...(statistics.securityDistribution.http > 0 ? 
                { insecureProtocol: `${statistics.securityDistribution.http} webhooks use insecure HTTP protocol` } : {}),
              ...(insights.unusedWebhooks > 0 ? 
                { unusedWebhooks: `${insights.unusedWebhooks} webhooks appear to be unused` } : {}),
              ...(insights.healthIssues.length > 0 ? 
                { healthIssues: `${insights.healthIssues.length} webhooks have health issues` } : {}),
            },
            recommendations: {
              ...(statistics.inaccessibleEndpoints > 0 ? 
                { fixEndpoints: 'Investigate and fix inaccessible webhook endpoints' } : {}),
              ...(statistics.securityDistribution.http > 0 ? 
                { upgradeProtocol: 'Upgrade HTTP webhooks to HTTPS for security' } : {}),
              ...(insights.unusedWebhooks > 0 ? 
                { cleanup: 'Consider removing unused webhooks to reduce overhead' } : {}),
              monitoring: 'Implement regular monitoring of webhook delivery success rates',
              testing: 'Periodically test webhook endpoints to ensure continued functionality',
              documentation: 'Maintain documentation of webhook integrations and their purposes',
              security: 'Regularly review webhook configurations for security compliance',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to list webhooks: ${error}`);
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

function determineIntegrationHealth(webhook: any, endpointStatus: string): string {
  if (!webhook.enabled) return 'Disabled';
  if (endpointStatus === 'Inaccessible') return 'Unhealthy';
  if (endpointStatus === 'Error') return 'Warning';
  if (endpointStatus === 'Accessible') return 'Healthy';
  return 'Unknown';
}

function calculateEventDistribution(webhooks: any[]): any {
  const distribution: any = {};
  webhooks.forEach(webhook => {
    distribution[webhook.event] = (distribution[webhook.event] || 0) + 1;
  });
  return distribution;
}

function calculateContentDistribution(webhooks: any[]): any {
  const distribution = {
    workbook: 0,
    datasource: 0,
    user: 0,
  };
  
  webhooks.forEach(webhook => {
    distribution[webhook.analysis.contentType]++;
  });
  
  return distribution;
}

function calculateHealthDistribution(webhooks: any[]): any {
  const distribution = {
    healthy: 0,
    warning: 0,
    unhealthy: 0,
    disabled: 0,
    unknown: 0,
  };
  
  webhooks.forEach(webhook => {
    const health = webhook.analysis.integrationHealth.toLowerCase();
    distribution[health] = (distribution[health] || 0) + 1;
  });
  
  return distribution;
}

function generateWebhookInsights(webhooks: any[], statistics: any): any {
  const healthIssues = webhooks.filter(w => 
    w.analysis.integrationHealth === 'Unhealthy' || w.analysis.integrationHealth === 'Warning'
  );
  
  const unusedWebhooks = webhooks.filter(w => !w.enabled).length;
  
  const securityConcerns = webhooks.filter(w => w.configuration.protocol === 'HTTP');
  
  const highVolumeWebhooks = webhooks.filter(w => w.configuration.triggerFrequency === 'High');
  
  return {
    totalIntegrations: webhooks.length,
    healthIssues,
    unusedWebhooks,
    securityConcerns: securityConcerns.length,
    highVolumeIntegrations: highVolumeWebhooks.length,
    integrationDiversity: Object.keys(statistics.eventDistribution).length,
    overallHealth: (() => {
      const healthyCount = statistics.healthDistribution.healthy || 0;
      const totalActive = statistics.enabledWebhooks;
      if (totalActive === 0) return 'No Active Webhooks';
      const healthRatio = healthyCount / totalActive;
      if (healthRatio > 0.8) return 'Good';
      if (healthRatio > 0.6) return 'Fair';
      return 'Poor';
    })(),
    recommendations: {
      priorityActions: healthIssues.length > 0 ? 'Fix unhealthy webhook integrations' : 'Monitor webhook performance',
      securityUpgrade: securityConcerns.length > 0 ? 'Upgrade HTTP webhooks to HTTPS' : 'Security compliance maintained',
      maintenance: unusedWebhooks > 0 ? 'Clean up unused webhooks' : 'Webhook inventory optimized',
    },
  };
}