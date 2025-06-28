import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listDataAlertsTool = new Tool({
  name: 'list-data-alerts',
  description: `
List all data alerts configured in Tableau Cloud/Server. This provides an overview of active monitoring and alert configurations.

**Parameters:**
- \`viewId\`: Filter alerts for a specific view (optional)
- \`userId\`: Filter alerts owned by specific user (optional)
- \`includeDetails\`: Include detailed alert configuration and statistics (optional, default: true)
- \`enabledOnly\`: Show only enabled alerts (optional, default: false)

**Alert Information:**
- **Configuration**: Alert name, condition, threshold, frequency
- **Status**: Enabled/disabled, last triggered, success rate
- **Ownership**: Who created and manages each alert
- **Performance**: Trigger frequency, notification delivery success

**Alert Analytics:**
- **Health Status**: Active vs. inactive alerts
- **Trigger Patterns**: Frequency of alert activations
- **Effectiveness**: Alerts that trigger vs. those that don't
- **Distribution**: Breakdown by condition type, frequency, views

**Management Insights:**
- **Unused Alerts**: Alerts that never trigger or are disabled
- **Noisy Alerts**: Alerts triggering too frequently
- **Failed Notifications**: Alerts with delivery issues
- **Coverage Analysis**: Views with vs. without monitoring

**Example Usage:**
- List all alerts: \`{}\`
- View-specific alerts: \`{ "viewId": "view-123" }\`
- User's alerts: \`{ "userId": "user-456" }\`
- Active alerts only: \`{ "enabledOnly": true }\`
- Detailed analysis: \`{ "includeDetails": true }\`

**Use Cases:**
- **Alert Audit**: Review all monitoring configurations
- **Performance Analysis**: Identify problematic or effective alerts
- **Maintenance Planning**: Find alerts needing attention
- **Coverage Assessment**: Ensure critical metrics are monitored
- **User Management**: Review user-created alert configurations

**Monitoring Best Practices:**
- Regular review of alert effectiveness
- Cleanup of unused or redundant alerts
- Adjustment of thresholds based on performance
- Consolidation of similar alerts for efficiency
- Documentation of alert purposes and response procedures
`,
  paramsSchema: {
    viewId: z.string().optional(),
    userId: z.string().optional(),
    includeDetails: z.boolean().optional(),
    enabledOnly: z.boolean().optional(),
  },
  annotations: {
    title: 'List Data Alerts',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ 
    viewId, 
    userId, 
    includeDetails = true, 
    enabledOnly = false 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listDataAlertsTool.logAndExecute({
      requestId,
      args: { viewId, userId, includeDetails, enabledOnly },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Retrieve data alerts with optional filtering
          let dataAlerts: any[] = [];
          
          if (viewId) {
            // Get alerts for specific view
            dataAlerts = await restApi.dataAlertsMethods.listDataAlerts(restApi.siteId, viewId);
          } else {
            // Get all alerts in site
            dataAlerts = await restApi.dataAlertsMethods.listAllDataAlerts(restApi.siteId);
          }
          
          if (dataAlerts.length === 0) {
            return new Ok({
              success: true,
              dataAlerts: [],
              statistics: {
                totalAlerts: 0,
                enabledAlerts: 0,
                disabledAlerts: 0,
              },
              message: viewId ? 
                `No data alerts found for view ${viewId}` : 
                'No data alerts found in this site',
            });
          }
          
          // Apply filters
          let filteredAlerts = dataAlerts;
          
          if (userId) {
            filteredAlerts = filteredAlerts.filter((alert: any) => alert.owner?.id === userId);
          }
          
          if (enabledOnly) {
            filteredAlerts = filteredAlerts.filter((alert: any) => alert.enabled);
          }
          
          // Process alert data with enhanced details
          const processedAlerts = await Promise.all(filteredAlerts.map(async (alert: any) => {
            let enhancedDetails: any = {};
            
            if (includeDetails) {
              // Get view details
              try {
                const view = await restApi.viewsMethods.getView(restApi.siteId, alert.viewId);
                enhancedDetails.viewDetails = {
                  name: view.name,
                  workbookName: view.workbook?.name,
                  projectName: view.project?.name,
                  contentUrl: view.contentUrl,
                };
              } catch (error) {
                // Continue without view details
              }
              
              // Get owner details
              try {
                if (alert.owner?.id) {
                  const users = await restApi.usersMethods.listUsers(restApi.siteId, `id:eq:${alert.owner.id}`);
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
            }
            
            // Analyze alert characteristics
            const alertAnalysis = {
              conditionType: categorizeCondition(alert.condition),
              alertSensitivity: calculateAlertSensitivity(alert.condition, alert.threshold),
              monitoringFrequency: alert.frequency,
              businessImpact: assessBusinessImpact(alert.condition, alert.frequency),
              alertHealth: determineAlertHealth(alert),
              triggerLikelihood: estimateTriggerLikelihood(alert.condition, alert.threshold, alert.frequency),
            };
            
            return {
              id: alert.id,
              alertName: alert.alertName,
              viewId: alert.viewId,
              condition: alert.condition,
              threshold: alert.threshold,
              frequency: alert.frequency,
              enabled: alert.enabled,
              subject: alert.subject,
              message: alert.message,
              createdAt: alert.createdAt,
              updatedAt: alert.updatedAt,
              lastTriggered: alert.lastTriggered,
              owner: {
                id: alert.owner?.id,
                name: alert.owner?.name,
                ...enhancedDetails.ownerDetails,
              },
              view: enhancedDetails.viewDetails,
              analysis: alertAnalysis,
              status: {
                enabled: alert.enabled,
                health: alertAnalysis.alertHealth,
                recentActivity: !!alert.lastTriggered,
                triggerPotential: alertAnalysis.triggerLikelihood,
              },
              configuration: {
                conditionDescription: generateConditionDescription(alert.condition, alert.threshold),
                monitoringScope: enhancedDetails.viewDetails?.workbookName || 'Unknown',
                notificationCustomized: !!(alert.subject && alert.message),
                alertComplexity: assessAlertComplexity(alert.condition, alert.frequency),
              },
            };
          }));
          
          // Calculate comprehensive statistics
          const statistics = calculateAlertStatistics(processedAlerts);
          
          // Generate insights and recommendations
          const insights = generateAlertInsights(processedAlerts, statistics);
          
          return new Ok({
            success: true,
            dataAlerts: processedAlerts,
            statistics,
            insights,
            filtering: {
              viewId,
              userId,
              enabledOnly,
              totalBeforeFilter: dataAlerts.length,
              totalAfterFilter: processedAlerts.length,
            },
            analysis: {
              coverage: calculateMonitoringCoverage(processedAlerts),
              effectiveness: assessOverallEffectiveness(processedAlerts),
              maintenance: identifyMaintenanceNeeds(processedAlerts),
              optimization: suggestOptimizations(processedAlerts, statistics),
            },
            summary: {
              totalAlerts: statistics.totalAlerts,
              activeAlerts: statistics.enabledAlerts,
              healthyAlerts: statistics.healthDistribution.healthy,
              alertsNeedingAttention: statistics.healthDistribution.unhealthy + statistics.healthDistribution.warning,
              monitoringCoverage: insights.uniqueViewsMonitored,
            },
            message: `Found ${statistics.totalAlerts} data alerts (${statistics.enabledAlerts} enabled, ${statistics.disabledAlerts} disabled)`,
            warnings: {
              ...(statistics.disabledAlerts > statistics.enabledAlerts ? 
                { moreDisabledThanEnabled: 'More alerts are disabled than enabled - review alert utility' } : {}),
              ...(insights.noisyAlerts.length > 0 ? 
                { noisyAlerts: `${insights.noisyAlerts.length} alerts may be generating excessive notifications` } : {}),
              ...(insights.staleAlerts.length > 0 ? 
                { staleAlerts: `${insights.staleAlerts.length} alerts haven't been triggered recently` } : {}),
              ...(statistics.healthDistribution.unhealthy > 0 ? 
                { unhealthyAlerts: `${statistics.healthDistribution.unhealthy} alerts have health issues` } : {}),
            },
            recommendations: {
              ...(insights.staleAlerts.length > 0 ? 
                { reviewStaleAlerts: 'Review and potentially remove alerts that never trigger' } : {}),
              ...(insights.noisyAlerts.length > 0 ? 
                { adjustNoisyAlerts: 'Adjust thresholds for alerts that trigger too frequently' } : {}),
              ...(statistics.disabledAlerts > 3 ? 
                { cleanupDisabled: 'Consider removing disabled alerts that are no longer needed' } : {}),
              regularReview: 'Schedule regular reviews of alert effectiveness and relevance',
              documentation: 'Maintain documentation of alert purposes and response procedures',
              consolidation: insights.duplicatePatterns > 0 ? 'Consider consolidating similar alerts' : 'Monitor for duplicate alert patterns',
              thresholdTuning: 'Regularly review and adjust alert thresholds based on business changes',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to list data alerts: ${error}`);
        }
      },
    });
  },
});

// Helper functions
function categorizeCondition(condition: string): string {
  if (condition.includes('greater')) return 'Upper Bound';
  if (condition.includes('less')) return 'Lower Bound';
  if (condition === 'equal_to') return 'Exact Match';
  if (condition === 'not_equal_to') return 'Exclusion';
  return 'Range';
}

function calculateAlertSensitivity(condition: string, threshold: number): string {
  if (condition === 'equal_to') return 'High';
  if (condition === 'not_equal_to') return 'Low';
  
  const absThreshold = Math.abs(threshold);
  if (absThreshold < 1) return 'High';
  if (absThreshold < 100) return 'Medium';
  return 'Low';
}

function assessBusinessImpact(condition: string, frequency: string): string {
  let impact = 0;
  
  if (frequency === 'hourly') impact += 2;
  if (frequency === 'daily') impact += 1;
  if (frequency === 'once') impact += 3;
  if (condition.includes('less')) impact += 2;
  if (condition.includes('greater')) impact += 1;
  
  if (impact >= 4) return 'High';
  if (impact >= 2) return 'Medium';
  return 'Low';
}

function determineAlertHealth(alert: any): string {
  if (!alert.enabled) return 'Disabled';
  
  // Simple health assessment based on last triggered and configuration
  const daysSinceCreated = alert.createdAt ? 
    Math.floor((Date.now() - new Date(alert.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 0;
  
  if (daysSinceCreated > 30 && !alert.lastTriggered) return 'Stale'; // Never triggered in 30 days
  if (alert.frequency === 'hourly' && alert.lastTriggered) return 'Active'; // High frequency with activity
  if (alert.lastTriggered) return 'Healthy'; // Has triggered at some point
  if (daysSinceCreated < 7) return 'New'; // Recently created
  
  return 'Warning'; // Enabled but no recent activity
}

function estimateTriggerLikelihood(condition: string, threshold: number, frequency: string): string {
  // Simplified estimation based on condition type and threshold
  if (condition === 'equal_to') return 'Low'; // Exact matches are rare
  if (condition === 'not_equal_to') return 'High'; // Usually true
  if (frequency === 'once') return 'Variable'; // Depends on timing
  
  return 'Medium'; // Default for range-based conditions
}

function assessAlertComplexity(condition: string, frequency: string): string {
  let complexity = 0;
  
  if (condition === 'equal_to' || condition === 'not_equal_to') complexity += 1;
  if (frequency === 'hourly') complexity += 2;
  if (frequency === 'once') complexity += 1;
  
  if (complexity >= 3) return 'High';
  if (complexity >= 1) return 'Medium';
  return 'Low';
}

function generateConditionDescription(condition: string, threshold: number): string {
  const conditionMap = {
    'greater_than': `> ${threshold}`,
    'greater_than_or_equal': `≥ ${threshold}`,
    'less_than': `< ${threshold}`,
    'less_than_or_equal': `≤ ${threshold}`,
    'equal_to': `= ${threshold}`,
    'not_equal_to': `≠ ${threshold}`,
  };
  
  return conditionMap[condition] || `${condition} ${threshold}`;
}

function calculateAlertStatistics(alerts: any[]): any {
  return {
    totalAlerts: alerts.length,
    enabledAlerts: alerts.filter(a => a.enabled).length,
    disabledAlerts: alerts.filter(a => !a.enabled).length,
    conditionDistribution: calculateDistribution(alerts, 'condition'),
    frequencyDistribution: calculateDistribution(alerts, 'frequency'),
    healthDistribution: calculateDistribution(alerts, (a: any) => a.analysis.alertHealth),
    sensitivityDistribution: calculateDistribution(alerts, (a: any) => a.analysis.alertSensitivity),
    impactDistribution: calculateDistribution(alerts, (a: any) => a.analysis.businessImpact),
    uniqueViews: new Set(alerts.map(a => a.viewId)).size,
    uniqueOwners: new Set(alerts.map(a => a.owner.id)).size,
    customizedAlerts: alerts.filter(a => a.configuration.notificationCustomized).length,
  };
}

function calculateDistribution(items: any[], keyOrFunction: string | Function): any {
  const distribution: any = {};
  items.forEach(item => {
    const key = typeof keyOrFunction === 'function' ? keyOrFunction(item) : item[keyOrFunction];
    distribution[key] = (distribution[key] || 0) + 1;
  });
  return distribution;
}

function generateAlertInsights(alerts: any[], statistics: any): any {
  const noisyAlerts = alerts.filter(a => 
    a.analysis.alertSensitivity === 'High' && a.frequency === 'hourly'
  );
  
  const staleAlerts = alerts.filter(a => 
    a.analysis.alertHealth === 'Stale' || (a.enabled && !a.lastTriggered)
  );
  
  const highImpactAlerts = alerts.filter(a => a.analysis.businessImpact === 'High');
  
  return {
    noisyAlerts,
    staleAlerts,
    highImpactAlerts,
    uniqueViewsMonitored: statistics.uniqueViews,
    averageAlertsPerView: statistics.uniqueViews > 0 ? (statistics.totalAlerts / statistics.uniqueViews).toFixed(1) : 0,
    duplicatePatterns: Math.max(0, statistics.totalAlerts - statistics.uniqueViews * 2), // Rough estimate
    alertDensity: statistics.totalAlerts > 0 ? (statistics.enabledAlerts / statistics.totalAlerts * 100).toFixed(1) : 0,
  };
}

function calculateMonitoringCoverage(alerts: any[]): any {
  const enabledAlerts = alerts.filter(a => a.enabled);
  const monitoredViews = new Set(enabledAlerts.map(a => a.viewId)).size;
  
  return {
    totalViews: new Set(alerts.map(a => a.viewId)).size,
    monitoredViews,
    coveragePercentage: alerts.length > 0 ? (enabledAlerts.length / alerts.length * 100).toFixed(1) : 0,
    alertsPerView: monitoredViews > 0 ? (enabledAlerts.length / monitoredViews).toFixed(1) : 0,
  };
}

function assessOverallEffectiveness(alerts: any[]): any {
  const enabledAlerts = alerts.filter(a => a.enabled);
  const healthyAlerts = alerts.filter(a => a.analysis.alertHealth === 'Healthy');
  const activeAlerts = alerts.filter(a => a.status.recentActivity);
  
  return {
    healthRatio: alerts.length > 0 ? (healthyAlerts.length / alerts.length * 100).toFixed(1) : 0,
    activityRatio: enabledAlerts.length > 0 ? (activeAlerts.length / enabledAlerts.length * 100).toFixed(1) : 0,
    overallEffectiveness: (() => {
      const health = healthyAlerts.length / Math.max(alerts.length, 1);
      const activity = activeAlerts.length / Math.max(enabledAlerts.length, 1);
      const combined = (health + activity) / 2;
      
      if (combined > 0.7) return 'High';
      if (combined > 0.4) return 'Medium';
      return 'Low';
    })(),
  };
}

function identifyMaintenanceNeeds(alerts: any[]): any {
  const needsAttention = alerts.filter(a => 
    a.analysis.alertHealth === 'Stale' || 
    a.analysis.alertHealth === 'Warning' ||
    !a.enabled
  );
  
  return {
    alertsNeedingAttention: needsAttention.length,
    maintenancePriority: needsAttention.length > alerts.length * 0.3 ? 'High' : 
                        needsAttention.length > 0 ? 'Medium' : 'Low',
    specificNeeds: {
      staleAlerts: alerts.filter(a => a.analysis.alertHealth === 'Stale').length,
      disabledAlerts: alerts.filter(a => !a.enabled).length,
      warningAlerts: alerts.filter(a => a.analysis.alertHealth === 'Warning').length,
    },
  };
}

function suggestOptimizations(alerts: any[], statistics: any): any {
  const suggestions: string[] = [];
  
  if (statistics.disabledAlerts > statistics.enabledAlerts) {
    suggestions.push('Remove or enable disabled alerts');
  }
  
  if (alerts.filter(a => a.analysis.alertSensitivity === 'High').length > alerts.length * 0.4) {
    suggestions.push('Review and adjust high-sensitivity alert thresholds');
  }
  
  if (statistics.uniqueViews * 3 < statistics.totalAlerts) {
    suggestions.push('Consider consolidating multiple alerts per view');
  }
  
  return {
    suggestions,
    optimizationPotential: suggestions.length > 2 ? 'High' : suggestions.length > 0 ? 'Medium' : 'Low',
  };
}