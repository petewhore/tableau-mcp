import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const createWebhookTool = new Tool({
  name: 'create-webhook',
  description: `
Create a new webhook in Tableau Cloud/Server to receive notifications about content events. Webhooks enable real-time integration with external systems.

**Parameters:**
- \`name\`: Name for the webhook (required)
- \`url\`: Target URL for webhook notifications (required)
- \`event\`: Event type to trigger the webhook (required)
- \`contentType\`: Type of content to monitor - workbook, datasource, or user (optional)
- \`enabled\`: Whether the webhook is active (optional, default: true)

**Supported Events:**
- **WorkbookCreated**: Triggered when a workbook is published
- **WorkbookUpdated**: Triggered when a workbook is republished or modified
- **WorkbookDeleted**: Triggered when a workbook is deleted
- **DatasourceCreated**: Triggered when a data source is published
- **DatasourceUpdated**: Triggered when a data source is updated or refreshed
- **DatasourceDeleted**: Triggered when a data source is deleted
- **UserAdded**: Triggered when a user is added to the site
- **UserRemoved**: Triggered when a user is removed from the site
- **UserUpdated**: Triggered when user properties are modified

**Webhook Payload:**
- **Event Metadata**: Timestamp, event type, site information
- **Content Details**: ID, name, project, owner information
- **Change Information**: What specifically changed (for update events)
- **User Context**: Who triggered the event

**Integration Patterns:**
- **CI/CD Integration**: Trigger deployments when content is published
- **Monitoring**: Alert systems when content changes
- **Audit Systems**: Log all content modifications
- **Data Pipeline**: Trigger downstream processes on data updates
- **Notification Systems**: Send alerts to teams about important changes

**Security Considerations:**
- **HTTPS Required**: Webhook URLs must use HTTPS for security
- **Authentication**: Consider webhook signature validation
- **Rate Limiting**: Implement rate limiting on receiving endpoint
- **Error Handling**: Graceful handling of delivery failures

**Example Usage:**
- Monitor workbook changes: \`{ "name": "Workbook Monitor", "url": "https://api.company.com/webhooks/tableau", "event": "WorkbookUpdated" }\`
- Data source alerts: \`{ "name": "Data Source Updates", "url": "https://alerts.company.com/tableau", "event": "DatasourceCreated", "contentType": "datasource" }\`
- User management: \`{ "name": "User Changes", "url": "https://identity.company.com/tableau-users", "event": "UserAdded" }\`

**Best Practices:**
- Use descriptive names for webhook identification
- Implement idempotent webhook handlers
- Log webhook deliveries for troubleshooting
- Test webhook endpoints before enabling
- Monitor webhook delivery success rates
- Implement retry logic for failed deliveries

**Troubleshooting:**
- Verify target URL is accessible and returns 2xx status codes
- Check webhook payload format matches your handler expectations
- Monitor Tableau webhook delivery logs for failures
- Validate SSL certificates on target endpoints
`,
  paramsSchema: {
    name: z.string().min(1, 'Webhook name is required'),
    url: z.string().url('Valid HTTPS URL is required'),
    event: z.enum([
      'WorkbookCreated',
      'WorkbookUpdated', 
      'WorkbookDeleted',
      'DatasourceCreated',
      'DatasourceUpdated',
      'DatasourceDeleted',
      'UserAdded',
      'UserRemoved',
      'UserUpdated'
    ]),
    contentType: z.enum(['workbook', 'datasource', 'user']).optional(),
    enabled: z.boolean().optional(),
  },
  annotations: {
    title: 'Create Webhook',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    name, 
    url, 
    event, 
    contentType, 
    enabled = true 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await createWebhookTool.logAndExecute({
      requestId,
      args: { name, url, event, contentType, enabled },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Validate URL is HTTPS
          if (!url.startsWith('https://')) {
            return new Err('Webhook URL must use HTTPS for security');
          }
          
          // Validate event-content type compatibility
          const eventContentMap = {
            'WorkbookCreated': 'workbook',
            'WorkbookUpdated': 'workbook',
            'WorkbookDeleted': 'workbook',
            'DatasourceCreated': 'datasource',
            'DatasourceUpdated': 'datasource',
            'DatasourceDeleted': 'datasource',
            'UserAdded': 'user',
            'UserRemoved': 'user',
            'UserUpdated': 'user',
          };
          
          const expectedContentType = eventContentMap[event];
          if (contentType && contentType !== expectedContentType) {
            return new Err(`Event '${event}' is not compatible with contentType '${contentType}'. Expected '${expectedContentType}'`);
          }
          
          // Check if webhook with same name already exists
          try {
            const existingWebhooks = await restApi.webhooksMethods.listWebhooks(restApi.siteId);
            const duplicateName = existingWebhooks.some((webhook: any) => webhook.name === name);
            if (duplicateName) {
              return new Err(`Webhook with name '${name}' already exists`);
            }
          } catch (error) {
            // Continue if we can't check existing webhooks
          }
          
          // Test webhook endpoint accessibility (optional validation)
          let endpointAccessible = false;
          try {
            const testResponse = await fetch(url, { 
              method: 'HEAD',
              signal: AbortSignal.timeout(5000) // 5 second timeout
            });
            endpointAccessible = testResponse.ok;
          } catch (error) {
            // Endpoint test failed, but we'll still create the webhook
          }
          
          // Create the webhook
          const webhook = await restApi.webhooksMethods.createWebhook(restApi.siteId, {
            name,
            url,
            event,
            enabled,
          });
          
          // Analyze webhook configuration
          const webhookAnalysis = {
            eventCategory: event.includes('Workbook') ? 'Content' : 
                         event.includes('Datasource') ? 'Data' : 'User',
            triggerFrequency: estimateTriggerFrequency(event),
            integrationComplexity: assessIntegrationComplexity(event, url),
            securityLevel: url.startsWith('https://') ? 'Secure' : 'Insecure',
            contentScope: expectedContentType,
          };
          
          // Generate integration recommendations
          const integrationRecommendations = generateIntegrationRecommendations(event, webhookAnalysis);
          
          return new Ok({
            success: true,
            webhookCreated: true,
            webhook: {
              id: webhook.id,
              name: webhook.name,
              url: webhook.url,
              event: webhook.event,
              enabled: webhook.enabled,
              createdAt: webhook.createdAt,
              ownerId: webhook.owner?.id,
              ownerName: webhook.owner?.name,
            },
            configuration: {
              event,
              contentScope: expectedContentType,
              triggerType: webhookAnalysis.eventCategory,
              enabled,
              securityLevel: webhookAnalysis.securityLevel,
            },
            analysis: webhookAnalysis,
            endpoint: {
              url,
              accessible: endpointAccessible,
              protocol: url.startsWith('https://') ? 'HTTPS' : 'HTTP',
              tested: true,
            },
            payload: {
              expectedFormat: 'JSON',
              includesMetadata: true,
              includesContentDetails: true,
              includesUserContext: true,
              sampleStructure: generateSamplePayload(event, expectedContentType),
            },
            summary: {
              webhookName: name,
              targetUrl: url,
              monitoredEvent: event,
              contentType: expectedContentType,
              activeStatus: enabled,
              integrationReady: endpointAccessible && enabled,
            },
            message: `Successfully created webhook '${name}' for ${event} events targeting ${url}`,
            warnings: {
              ...(!endpointAccessible ? 
                { endpointInaccessible: 'Target URL could not be reached during validation - verify endpoint is available' } : {}),
              ...(webhookAnalysis.triggerFrequency === 'High' ? 
                { highVolume: 'This event type may generate high volume of notifications - ensure endpoint can handle the load' } : {}),
              ...(webhookAnalysis.integrationComplexity === 'High' ? 
                { complexity: 'Complex integration detected - thorough testing recommended' } : {}),
            },
            recommendations: integrationRecommendations,
            nextSteps: {
              testing: 'Test webhook by triggering the monitored event type in Tableau',
              monitoring: 'Monitor webhook delivery success rates and response times',
              errorHandling: 'Implement proper error handling and retry logic in your endpoint',
              security: 'Consider implementing webhook signature validation for security',
              documentation: 'Document webhook integration for team reference',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to create webhook: ${error}`);
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

function assessIntegrationComplexity(event: string, url: string): string {
  let complexity = 0;
  
  // Event complexity
  if (event.includes('Updated')) complexity += 2; // Update events have more complex payloads
  if (event.includes('User')) complexity += 1; // User events may require identity integration
  
  // URL complexity indicators
  if (url.includes('webhook') || url.includes('api')) complexity += 1; // Dedicated webhook/API endpoints
  if (url.includes('localhost') || url.includes('127.0.0.1')) complexity -= 1; // Local testing
  
  if (complexity >= 3) return 'High';
  if (complexity >= 1) return 'Medium';
  return 'Low';
}

function generateIntegrationRecommendations(event: string, analysis: any): any {
  const recommendations: any = {
    endpoint: 'Ensure webhook endpoint returns 2xx status codes for successful delivery',
    testing: 'Test webhook thoroughly with sample events before enabling in production',
    monitoring: 'Implement monitoring for webhook delivery success rates',
  };
  
  if (analysis.triggerFrequency === 'High') {
    recommendations.performance = 'Implement efficient processing for high-volume webhook notifications';
    recommendations.rateLimit = 'Consider implementing rate limiting on your webhook endpoint';
  }
  
  if (event.includes('Updated')) {
    recommendations.idempotency = 'Implement idempotent processing to handle duplicate notifications gracefully';
    recommendations.changeDetection = 'Parse webhook payload to identify specific changes made';
  }
  
  if (event.includes('User')) {
    recommendations.identity = 'Integrate with identity management systems for user event processing';
    recommendations.privacy = 'Ensure user data handling complies with privacy regulations';
  }
  
  if (analysis.integrationComplexity === 'High') {
    recommendations.architecture = 'Consider implementing a webhook processing queue for complex integrations';
    recommendations.errorHandling = 'Implement comprehensive error handling and retry mechanisms';
  }
  
  return recommendations;
}

function generateSamplePayload(event: string, contentType: string): any {
  const basePayload = {
    event_type: event,
    created_at: '2024-01-15T10:30:00Z',
    site_luid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    site_name: 'My Site',
  };
  
  if (contentType === 'workbook') {
    return {
      ...basePayload,
      resource: {
        workbook_luid: 'wb-1234567890abcdef',
        workbook_name: 'Sales Dashboard',
        project_luid: 'proj-1234567890abcdef',
        project_name: 'Analytics',
        owner_luid: 'user-1234567890abcdef',
        owner_name: 'john.doe',
        created_at: '2024-01-15T10:30:00Z',
        updated_at: '2024-01-15T10:30:00Z',
      },
    };
  } else if (contentType === 'datasource') {
    return {
      ...basePayload,
      resource: {
        datasource_luid: 'ds-1234567890abcdef',
        datasource_name: 'Sales Data',
        project_luid: 'proj-1234567890abcdef',
        project_name: 'Data Sources',
        owner_luid: 'user-1234567890abcdef',
        owner_name: 'jane.smith',
        created_at: '2024-01-15T10:30:00Z',
        updated_at: '2024-01-15T10:30:00Z',
      },
    };
  } else {
    return {
      ...basePayload,
      resource: {
        user_luid: 'user-1234567890abcdef',
        user_name: 'new.user',
        site_role: 'Explorer',
        locale: 'en_US',
        created_at: '2024-01-15T10:30:00Z',
        updated_at: '2024-01-15T10:30:00Z',
      },
    };
  }
}