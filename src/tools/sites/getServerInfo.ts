import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const getServerInfoTool = new Tool({
  name: 'get-server-info',
  description: `
Get comprehensive information about the Tableau Server/Cloud instance, including version, API capabilities, and system status.

**No Parameters Required** - This tool provides system-wide information accessible to authenticated users.

**Server Information Includes:**
- **Version Details**: Product version, build number, schema version
- **API Capabilities**: Supported API versions and endpoints
- **System Status**: Maintenance mode, health indicators
- **Configuration**: Server settings and capabilities

**Version Information:**
- **Product Version**: Major.minor.patch version (e.g., 2024.1.0)
- **Build Number**: Specific build identifier for support purposes
- **Schema Version**: Database schema version for compatibility
- **REST API Version**: Current REST API version supported

**API Compatibility:**
- **Supported Versions**: List of REST API versions available
- **Current Version**: Active API version being used
- **Deprecation Info**: Older versions that may be deprecated

**Example Usage:**
- System health check: \`{}\`
- Version verification before API calls
- Troubleshooting compatibility issues
- Planning upgrades and migrations

**Use Cases:**
- **System Administration**: Monitor server health and status
- **API Development**: Verify compatibility and available endpoints
- **Troubleshooting**: Gather system information for support
- **Compliance**: Document system versions for auditing
- **Capacity Planning**: Understand system capabilities and limits
- **Integration Planning**: Verify API features before development
`,
  paramsSchema: {},
  annotations: {
    title: 'Get Server Information',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async (_, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await getServerInfoTool.logAndExecute({
      requestId,
      args: {},
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          const serverInfo = await restApi.sitesMethods.getServerInfo();
          
          // Parse version information
          const versionParts = serverInfo.productVersion.split('.');
          const majorVersion = parseInt(versionParts[0]) || 0;
          const minorVersion = parseInt(versionParts[1]) || 0;
          const patchVersion = parseInt(versionParts[2]) || 0;
          
          // Analyze API version support
          const apiVersions = serverInfo.supportedApiVersions || [];
          const currentApiVersion = serverInfo.restApiVersion;
          const latestApiVersion = apiVersions.length > 0 
            ? apiVersions[apiVersions.length - 1] 
            : currentApiVersion;
          
          // Determine system status and health
          const isInMaintenance = serverInfo.isMaintenanceMode || false;
          const hasMaintenanceMessage = !!serverInfo.maintenanceMessage;
          
          // Analyze version currency (rough estimates)
          const isCurrentVersion = majorVersion >= 2024;
          const isLegacyVersion = majorVersion < 2022;
          const supportLevel = isCurrentVersion ? 'Current' : 
                              isLegacyVersion ? 'Legacy' : 'Supported';
          
          // Feature availability based on version
          const featureSupport = {
            metadataApi: majorVersion >= 2019,
            vizqlDataService: majorVersion >= 2020,
            flows: majorVersion >= 2018,
            subscriptions: majorVersion >= 2018,
            webhooks: majorVersion >= 2019,
            connectedApps: majorVersion >= 2021,
            embeddedAnalytics: majorVersion >= 2020,
            askData: majorVersion >= 2019,
            explainData: majorVersion >= 2019,
          };
          
          return new Ok({
            success: true,
            serverInfo: {
              productVersion: serverInfo.productVersion,
              buildNumber: serverInfo.buildNumber,
              restApiVersion: serverInfo.restApiVersion,
              schemaVersion: serverInfo.schemaVersion,
              supportedApiVersions: serverInfo.supportedApiVersions,
              isMaintenanceMode: serverInfo.isMaintenanceMode,
              maintenanceMessage: serverInfo.maintenanceMessage,
            },
            versionAnalysis: {
              majorVersion,
              minorVersion,
              patchVersion,
              supportLevel,
              isCurrentVersion,
              isLegacyVersion,
              versionString: `${majorVersion}.${minorVersion}.${patchVersion}`,
            },
            apiSupport: {
              currentApiVersion,
              latestApiVersion,
              supportedVersions: apiVersions,
              totalVersionsSupported: apiVersions.length,
              isUsingLatest: currentApiVersion === latestApiVersion,
            },
            systemStatus: {
              isOperational: !isInMaintenance,
              isInMaintenance,
              hasMaintenanceMessage,
              statusIndicator: isInMaintenance ? 'Maintenance' : 'Operational',
            },
            featureSupport,
            capabilities: {
              canUseMetadataApi: featureSupport.metadataApi,
              canUseVizqlDataService: featureSupport.vizqlDataService,
              supportsFlows: featureSupport.flows,
              supportsSubscriptions: featureSupport.subscriptions,
              supportsWebhooks: featureSupport.webhooks,
              supportsEmbedding: featureSupport.embeddedAnalytics,
            },
            summary: {
              version: serverInfo.productVersion,
              buildNumber: serverInfo.buildNumber,
              apiVersion: currentApiVersion,
              systemStatus: isInMaintenance ? 'Under Maintenance' : 'Operational',
              supportLevel,
              featureCount: Object.values(featureSupport).filter(Boolean).length,
            },
            message: `Tableau Server ${serverInfo.productVersion} (Build ${serverInfo.buildNumber}) - ${isInMaintenance ? 'Under Maintenance' : 'Operational'}`,
            warnings: {
              ...(isInMaintenance ? 
                { maintenanceMode: `Server is in maintenance mode${hasMaintenanceMessage ? ': ' + serverInfo.maintenanceMessage : ''}` } : {}),
              ...(isLegacyVersion ? 
                { legacyVersion: 'Server is running a legacy version - consider upgrading for latest features and security updates' } : {}),
              ...(currentApiVersion !== latestApiVersion ? 
                { apiVersion: `Using API version ${currentApiVersion}, but ${latestApiVersion} is available` } : {}),
            },
            recommendations: {
              ...(isLegacyVersion ? 
                { upgrade: 'Plan upgrade to a current version for improved security and features' } : {}),
              ...(currentApiVersion !== latestApiVersion ? 
                { apiUpgrade: `Consider using API version ${latestApiVersion} for latest capabilities` } : {}),
              ...(isInMaintenance ? 
                { maintenance: 'Wait for maintenance to complete before performing critical operations' } : {}),
              monitoring: 'Regularly check server status and plan for version updates',
              documentation: 'Keep server version and capabilities documented for development teams',
              compatibility: 'Test applications with new API versions before upgrading',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to get server information: ${error}`);
        }
      },
    });
  },
});