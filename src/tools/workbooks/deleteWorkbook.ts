import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const deleteWorkbookTool = new Tool({
  name: 'delete-workbook',
  description: `
Delete a workbook from Tableau Cloud/Server. This permanently removes the workbook and all its views, affecting subscriptions and favorites.

**Parameters:**
- \`workbookId\`: ID of the workbook to delete (required)
- \`workbookName\`: Optional workbook name for reference (will be looked up if not provided)

**Deletion Impact:**
- **Permanent Removal**: Workbook and all views are permanently deleted
- **View Dependencies**: All views within the workbook are removed
- **Subscriptions**: Any subscriptions to workbook views are cancelled
- **Favorites**: Workbook is removed from all user favorites
- **Permissions**: All permissions associated with the workbook are removed
- **Usage History**: View usage statistics are lost

**Content Affected:**
- **All Views**: Every worksheet and dashboard in the workbook
- **Embedded Data**: Any embedded data sources within the workbook
- **Custom Settings**: Workbook-specific configurations and formatting
- **Revision History**: All previous versions are permanently lost

**Pre-deletion Analysis:**
- Counts views and estimates user impact
- Identifies subscriptions that will be affected
- Warns about data loss and recovery limitations

**Use Cases:**
- **Content Cleanup**: Remove unused or obsolete workbooks
- **Migration**: Delete old versions after successful migration
- **Error Correction**: Remove incorrectly published workbooks
- **License Management**: Free up content slots and storage
- **Decommissioning**: Remove workbooks during system changes

**Best Practices:**
- Download workbook backup before deletion if needed
- Check for active subscriptions and notify subscribers
- Communicate with users before deleting shared workbooks
- Consider moving to archive project instead of deletion
- Document deletion reasons for audit and compliance

**Example Usage:**
- Simple deletion: \`{ "workbookId": "wb-123" }\`
- With reference name: \`{ "workbookId": "wb-456", "workbookName": "Legacy Sales Dashboard" }\`

**Recovery:**
- **No Recovery**: Deletion is permanent and cannot be undone
- **Backup Required**: Must republish from original .twbx file if recovery needed
- **Data Loss**: All view usage statistics and revision history are lost
`,
  paramsSchema: {
    workbookId: z.string().min(1, 'Workbook ID is required'),
    workbookName: z.string().optional(),
  },
  annotations: {
    title: 'Delete Workbook',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ workbookId, workbookName }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await deleteWorkbookTool.logAndExecute({
      requestId,
      args: { workbookId, workbookName },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Get workbook details before deletion
          let workbook;
          try {
            workbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, workbookId);
          } catch (error) {
            return new Err(`Workbook with ID '${workbookId}' not found`);
          }
          
          const resolvedWorkbookName = workbookName || workbook.name;
          
          // Get views in the workbook before deletion
          let views: any[] = [];
          let viewCount = 0;
          try {
            const viewsResponse = await restApi.workbooksMethods.getWorkbookViews(restApi.siteId, workbookId);
            views = viewsResponse.views || [];
            viewCount = views.length;
          } catch (error) {
            // Continue with deletion even if we can't get views
          }
          
          // Check for subscriptions that might be affected
          let affectedSubscriptions = 0;
          try {
            const subscriptions = await restApi.viewsMethods.listSubscriptions(restApi.siteId);
            // Count subscriptions for views in this workbook
            affectedSubscriptions = subscriptions.subscriptions.filter(sub => 
              sub.content.type === 'View' && 
              views.some(view => view.id === sub.content.id)
            ).length;
            
            // Also count workbook-level subscriptions
            const workbookSubscriptions = subscriptions.subscriptions.filter(sub => 
              sub.content.type === 'Workbook' && sub.content.id === workbookId
            ).length;
            
            affectedSubscriptions += workbookSubscriptions;
          } catch (error) {
            // Continue with deletion even if we can't check subscriptions
          }
          
          // Analyze workbook characteristics for impact assessment
          const isLarge = workbook.size ? workbook.size > 5000000 : false; // 5MB threshold
          const hasExtracts = workbook.hasExtracts || false;
          const projectName = workbook.project?.name || 'Unknown';
          const ownerName = workbook.owner?.name || 'Unknown';
          const hasViews = viewCount > 0;
          const hasManyViews = viewCount > 5;
          
          // Estimate deletion impact and risk
          const deletionRisk = (() => {
            let risk = 0;
            if (hasManyViews) risk += 3; // Many views = high user impact
            if (affectedSubscriptions > 0) risk += 3; // Active subscriptions
            if (hasExtracts) risk += 2; // Extract data will be lost
            if (isLarge) risk += 2; // Large workbook harder to recreate
            if (workbook.tags && workbook.tags.length > 0) risk += 1; // Tagged content likely important
            
            if (risk >= 7) return 'Critical';
            if (risk >= 5) return 'High';
            if (risk >= 3) return 'Medium';
            return 'Low';
          })();
          
          // Store deletion context before actual deletion
          const deletionContext = {
            workbookId: workbook.id,
            workbookName: workbook.name,
            projectName,
            ownerName,
            viewCount,
            viewNames: views.map(v => v.name),
            hasExtracts,
            size: workbook.size,
            contentUrl: workbook.contentUrl,
            createdAt: workbook.createdAt,
            updatedAt: workbook.updatedAt,
            tags: workbook.tags,
            affectedSubscriptions,
            deletionRisk,
            deletedAt: new Date().toISOString(),
          };
          
          // Perform the deletion
          await restApi.workbooksMethods.deleteWorkbook(restApi.siteId, workbookId);
          
          return new Ok({
            success: true,
            deleted: true,
            workbook: deletionContext,
            impact: {
              deletionRisk,
              viewsDeleted: viewCount,
              subscriptionsCancelled: affectedSubscriptions,
              dataLoss: hasExtracts ? 'Extract data permanently lost' : 'Live connections only',
              sizeLost: workbook.size ? `${Math.round(workbook.size / 1024)} KB` : 'Unknown',
              permanentDeletion: true,
              recoveryPossible: false,
            },
            affectedContent: {
              views: views.map(view => ({
                id: view.id,
                name: view.name,
                contentUrl: view.contentUrl,
              })),
              totalViews: viewCount,
              subscriptions: affectedSubscriptions,
              favorites: 'Unknown (removed from all user favorites)',
            },
            warnings: {
              permanent: 'Workbook deletion is permanent and cannot be undone',
              allViews: `All ${viewCount} views in the workbook have been permanently deleted`,
              subscriptions: affectedSubscriptions > 0 ? 
                `${affectedSubscriptions} subscriptions have been automatically cancelled` : undefined,
              extractData: hasExtracts ? 'All extract data has been permanently lost' : undefined,
              favorites: 'Workbook has been removed from all user favorites',
            },
            summary: {
              workbookName: resolvedWorkbookName,
              projectName,
              ownerName,
              deletionRisk,
              viewsDeleted: viewCount,
              subscriptionsCancelled: affectedSubscriptions,
              hadExtracts: hasExtracts,
              deletionSuccessful: true,
            },
            message: `Successfully deleted workbook '${resolvedWorkbookName}' and ${viewCount} views from project '${projectName}'`,
            recommendations: {
              userCommunication: affectedSubscriptions > 0 ? 
                'Notify users whose subscriptions were cancelled due to workbook deletion' : 
                'Notify users who may have been using views from this workbook',
              alternativeContent: 'Provide users with alternative dashboards or reports if available',
              documentation: 'Document the deletion reason and any replacement content',
              monitoring: 'Monitor for user requests related to missing content',
              ...(deletionRisk === 'Critical' || deletionRisk === 'High' ? 
                { urgentNotification: 'High-impact deletion - send immediate notification to affected users' } : {}),
            },
          });
          
        } catch (error) {
          return new Err(`Failed to delete workbook: ${error}`);
        }
      },
    });
  },
});