import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const createDataAlertTool = new Tool({
  name: 'create-data-alert',
  description: `
Create a data-driven alert in Tableau Cloud/Server that monitors specific metrics and notifies users when conditions are met.

**Parameters:**
- \`viewId\`: ID of the view containing the metric to monitor (required)
- \`alertName\`: Name for the data alert (required)
- \`condition\`: Alert condition - greater_than, less_than, equal_to, etc. (required)
- \`threshold\`: Threshold value to trigger the alert (required)
- \`frequency\`: How often to check the condition - once, daily, weekly (required)
- \`subject\`: Email subject for alert notifications (optional)
- \`message\`: Custom message for alert notifications (optional)

**Alert Conditions:**
- **greater_than**: Trigger when metric exceeds threshold
- **greater_than_or_equal**: Trigger when metric meets or exceeds threshold
- **less_than**: Trigger when metric falls below threshold
- **less_than_or_equal**: Trigger when metric is at or below threshold
- **equal_to**: Trigger when metric exactly matches threshold
- **not_equal_to**: Trigger when metric differs from threshold

**Monitoring Frequency:**
- **once**: Check condition once and alert if true, then deactivate
- **daily**: Check condition once per day
- **weekly**: Check condition once per week
- **hourly**: Check condition every hour (if supported)

**Alert Components:**
- **Metric Selection**: Specific measure or calculated field to monitor
- **Threshold Configuration**: Numeric value for comparison
- **Notification Setup**: Email recipients and message customization
- **Scheduling**: When and how often to evaluate the condition

**Use Cases:**
- **Performance Monitoring**: Alert when KPIs fall below targets
- **Anomaly Detection**: Detect unusual spikes or drops in metrics
- **Operational Alerts**: Monitor system health and business metrics
- **Compliance Monitoring**: Ensure metrics stay within required ranges
- **Quality Control**: Alert on data quality issues or missing data

**Business Intelligence:**
- **Proactive Management**: Catch issues before they become critical
- **Automated Monitoring**: Reduce manual dashboard checking
- **Stakeholder Notification**: Keep decision-makers informed automatically
- **Performance Tracking**: Monitor progress toward goals and targets

**Example Usage:**
- Sales target: \`{ "viewId": "view-123", "alertName": "Daily Sales Alert", "condition": "less_than", "threshold": 10000, "frequency": "daily" }\`
- Error monitoring: \`{ "viewId": "view-456", "alertName": "Error Rate Alert", "condition": "greater_than", "threshold": 0.05, "frequency": "hourly" }\`
- Custom message: \`{ "viewId": "view-789", "alertName": "Inventory Alert", "condition": "less_than", "threshold": 100, "frequency": "daily", "subject": "Low Inventory Warning", "message": "Inventory has fallen below minimum threshold" }\`

**Best Practices:**
- Choose meaningful threshold values based on business context
- Use descriptive alert names for easy identification
- Set appropriate frequency to balance timeliness with alert fatigue
- Customize messages to provide actionable information
- Test alerts with temporary thresholds before production deployment
- Regular review of alert effectiveness and threshold accuracy

**Performance Considerations:**
- Frequent alerts (hourly) may impact system performance
- Complex views may slow alert evaluation
- Multiple alerts on same view share evaluation overhead
- Consider data refresh frequency when setting alert frequency
`,
  paramsSchema: {
    viewId: z.string().min(1, 'View ID is required'),
    alertName: z.string().min(1, 'Alert name is required'),
    condition: z.enum([
      'greater_than',
      'greater_than_or_equal',
      'less_than',
      'less_than_or_equal',
      'equal_to',
      'not_equal_to'
    ]),
    threshold: z.number(),
    frequency: z.enum(['once', 'hourly', 'daily', 'weekly']),
    subject: z.string().optional(),
    message: z.string().optional(),
  },
  annotations: {
    title: 'Create Data Alert',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    viewId, 
    alertName, 
    condition, 
    threshold, 
    frequency, 
    subject, 
    message 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await createDataAlertTool.logAndExecute({
      requestId,
      args: { viewId, alertName, condition, threshold, frequency, subject, message },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify view exists and get details
          let view;
          try {
            view = await restApi.viewsMethods.getView(restApi.siteId, viewId);
          } catch (error) {
            return new Err(`View with ID '${viewId}' not found`);
          }
          
          // Validate threshold value based on condition
          if (!isFinite(threshold)) {
            return new Err('Threshold must be a valid numeric value');
          }
          
          // Check if alert with same name already exists for this view
          try {
            const existingAlerts = await restApi.dataAlertsMethods.listDataAlerts(restApi.siteId, viewId);
            const duplicateName = existingAlerts.some((alert: any) => alert.alertName === alertName);
            if (duplicateName) {
              return new Err(`Data alert with name '${alertName}' already exists for this view`);
            }
          } catch (error) {
            // Continue if we can't check existing alerts
          }
          
          // Generate default subject and message if not provided
          const defaultSubject = subject || `Data Alert: ${alertName}`;
          const defaultMessage = message || generateDefaultMessage(alertName, condition, threshold, view.name);
          
          // Create the data alert
          const dataAlert = await restApi.dataAlertsMethods.createDataAlert(restApi.siteId, {
            viewId,
            alertName,
            condition,
            threshold,
            frequency,
            subject: defaultSubject,
            message: defaultMessage,
          });
          
          // Analyze alert configuration
          const alertAnalysis = {
            conditionType: categorizeCondition(condition),
            alertSensitivity: calculateAlertSensitivity(condition, threshold),
            monitoringFrequency: frequency,
            businessImpact: assessBusinessImpact(condition, frequency),
            alertComplexity: assessAlertComplexity(condition, frequency, !!subject, !!message),
          };
          
          // Estimate alert behavior
          const alertBehavior = estimateAlertBehavior(alertAnalysis, view);
          
          return new Ok({
            success: true,
            alertCreated: true,
            dataAlert: {
              id: dataAlert.id,
              alertName: dataAlert.alertName,
              viewId: dataAlert.viewId,
              viewName: view.name,
              condition: dataAlert.condition,
              threshold: dataAlert.threshold,
              frequency: dataAlert.frequency,
              subject: dataAlert.subject,
              message: dataAlert.message,
              createdAt: dataAlert.createdAt,
              enabled: dataAlert.enabled,
              ownerId: dataAlert.owner?.id,
              ownerName: dataAlert.owner?.name,
            },
            view: {
              id: view.id,
              name: view.name,
              workbookName: view.workbook?.name,
              projectName: view.project?.name,
              contentUrl: view.contentUrl,
            },
            configuration: {
              condition,
              threshold,
              frequency,
              conditionDescription: generateConditionDescription(condition, threshold),
              customizedNotification: !!(subject || message),
              alertType: alertAnalysis.conditionType,
            },
            analysis: alertAnalysis,
            behavior: alertBehavior,
            summary: {
              alertName,
              viewName: view.name,
              monitoringRule: `${condition.replace('_', ' ')} ${threshold}`,
              checkFrequency: frequency,
              notificationCustomized: !!(subject || message),
              alertReady: true,
            },
            message: `Successfully created data alert '${alertName}' monitoring view '${view.name}' for condition '${condition} ${threshold}'`,
            warnings: {
              ...(frequency === 'hourly' ? 
                { highFrequency: 'Hourly alerts may generate many notifications - ensure threshold is appropriate' } : {}),
              ...(alertAnalysis.alertSensitivity === 'High' ? 
                { sensitivity: 'High sensitivity alert may trigger frequently - consider adjusting threshold' } : {}),
              ...(condition === 'equal_to' ? 
                { exactMatch: 'Equal-to condition requires exact match - consider using range-based conditions for more reliable alerts' } : {}),
              ...(alertBehavior.potentialNoiseLevel === 'High' ? 
                { alertFatigue: 'Alert configuration may generate excessive notifications - monitor and adjust as needed' } : {}),
            },
            recommendations: {
              testing: 'Test alert with temporary threshold to verify behavior before production use',
              monitoring: 'Monitor alert frequency and adjust threshold or frequency if generating too many notifications',
              documentation: 'Document alert purpose and response procedures for team reference',
              ...(alertAnalysis.businessImpact === 'High' ? 
                { escalation: 'Consider setting up escalation procedures for high-impact alerts' } : {}),
              ...(frequency === 'once' ? 
                { followUp: 'One-time alert will deactivate after triggering - plan follow-up actions' } : {}),
              maintenance: 'Regularly review alert effectiveness and update thresholds as business needs change',
              recipients: 'Configure additional alert recipients if this affects multiple stakeholders',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to create data alert: ${error}`);
        }
      },
    });
  },
});

// Helper functions
function generateDefaultMessage(alertName: string, condition: string, threshold: number, viewName: string): string {
  const conditionText = condition.replace(/_/g, ' ');
  return `Alert '${alertName}' has been triggered. The metric in view '${viewName}' is ${conditionText} ${threshold}.`;
}

function categorizeCondition(condition: string): string {
  if (condition.includes('greater')) return 'Upper Bound';
  if (condition.includes('less')) return 'Lower Bound';
  if (condition === 'equal_to') return 'Exact Match';
  if (condition === 'not_equal_to') return 'Exclusion';
  return 'Range';
}

function calculateAlertSensitivity(condition: string, threshold: number): string {
  // Simplified sensitivity calculation based on condition type and threshold
  if (condition === 'equal_to') return 'High'; // Exact matches are very sensitive
  if (condition === 'not_equal_to') return 'Low'; // Exclusions are less sensitive
  
  // For numeric thresholds, sensitivity depends on the scale
  const absThreshold = Math.abs(threshold);
  if (absThreshold < 1) return 'High'; // Small thresholds are more sensitive
  if (absThreshold < 100) return 'Medium';
  return 'Low';
}

function assessBusinessImpact(condition: string, frequency: string): string {
  let impact = 0;
  
  // Frequency impact
  if (frequency === 'hourly') impact += 2;
  if (frequency === 'daily') impact += 1;
  if (frequency === 'once') impact += 3; // One-time alerts often for critical conditions
  
  // Condition impact
  if (condition.includes('less')) impact += 2; // Lower bounds often indicate problems
  if (condition.includes('greater')) impact += 1; // Upper bounds may indicate growth or issues
  
  if (impact >= 4) return 'High';
  if (impact >= 2) return 'Medium';
  return 'Low';
}

function assessAlertComplexity(condition: string, frequency: string, hasCustomSubject: boolean, hasCustomMessage: boolean): string {
  let complexity = 0;
  
  if (condition === 'equal_to' || condition === 'not_equal_to') complexity += 1;
  if (frequency === 'hourly') complexity += 2;
  if (hasCustomSubject) complexity += 1;
  if (hasCustomMessage) complexity += 1;
  
  if (complexity >= 4) return 'High';
  if (complexity >= 2) return 'Medium';
  return 'Low';
}

function estimateAlertBehavior(analysis: any, view: any): any {
  let noiseLevel = 'Low';
  
  // Estimate noise based on frequency and sensitivity
  if (analysis.monitoringFrequency === 'hourly' && analysis.alertSensitivity === 'High') {
    noiseLevel = 'High';
  } else if (analysis.monitoringFrequency === 'daily' && analysis.alertSensitivity === 'High') {
    noiseLevel = 'Medium';
  } else if (analysis.monitoringFrequency === 'hourly') {
    noiseLevel = 'Medium';
  }
  
  return {
    potentialNoiseLevel: noiseLevel,
    recommendedFrequency: analysis.alertSensitivity === 'High' ? 'daily' : analysis.monitoringFrequency,
    alertReliability: analysis.conditionType === 'Exact Match' ? 'Variable' : 'Stable',
    maintenanceRequired: analysis.alertComplexity === 'High' ? 'High' : 'Low',
    businessValue: analysis.businessImpact,
  };
}

function generateConditionDescription(condition: string, threshold: number): string {
  const conditionMap = {
    'greater_than': `exceeds ${threshold}`,
    'greater_than_or_equal': `is ${threshold} or higher`,
    'less_than': `falls below ${threshold}`,
    'less_than_or_equal': `is ${threshold} or lower`,
    'equal_to': `equals exactly ${threshold}`,
    'not_equal_to': `is not equal to ${threshold}`,
  };
  
  return conditionMap[condition] || `meets condition ${condition} with threshold ${threshold}`;
}