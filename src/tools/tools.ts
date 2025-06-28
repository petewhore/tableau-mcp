// Import original tools (maintained)
import { listDatasourcesTool as originalListDatasourcesTool } from './listDatasources/listDatasources.js';
import { listFieldsTool } from './listFields.js';
import { queryDatasourceTool } from './queryDatasource/queryDatasource.js';
import { readMetadataTool } from './readMetadata.js';

// Import our enhanced tools

// User management tools
import { createUserTool } from './users/createUser.js';
import { listUsersTool } from './users/listUsers.js';
import { updateUserTool } from './users/updateUser.js';
import { deleteUserTool } from './users/deleteUser.js';
import { getUserByNameTool } from './users/getUserByName.js';

// Enhanced datasource tools
import { refreshDatasourceTool } from './datasources/refreshDatasource.js';
import { updateDatasourceTool } from './datasources/updateDatasource.js';
import { deleteDatasourceTool } from './datasources/deleteDatasource.js';
import { publishDatasourceTool } from './datasources/publishDatasource.js';

// Workbook management tools
import { listWorkbooksTool } from './workbooks/listWorkbooks.js';
import { publishWorkbookTool } from './workbooks/publishWorkbook.js';
import { downloadWorkbookTool } from './workbooks/downloadWorkbook.js';
import { updateWorkbookTool } from './workbooks/updateWorkbook.js';
import { deleteWorkbookTool } from './workbooks/deleteWorkbook.js';

// Project management tools
import { createProjectTool } from './projects/createProject.js';
import { deleteProjectTool } from './projects/deleteProject.js';

// View management tools
import { listViewsTool } from './views/listViews.js';
import { getViewImageTool } from './views/getViewImage.js';
import { getViewDataTool } from './views/getViewData.js';

// Permission management tools
import { grantPermissionsTool } from './permissions/grantPermissions.js';
import { revokePermissionsTool } from './permissions/revokePermissions.js';
import { listPermissionsTool } from './permissions/listPermissions.js';
import { listContentPermissionsTool } from './permissions/listContentPermissions.js';
import { copyPermissionsTool } from './permissions/copyPermissions.js';

// Group management tools
import { createGroupTool } from './groups/createGroup.js';
import { listGroupsTool } from './groups/listGroups.js';
import { addUserToGroupTool } from './groups/addUserToGroup.js';
import { removeUserFromGroupTool } from './groups/removeUserFromGroup.js';
import { deleteGroupTool } from './groups/deleteGroup.js';

// Job management tools
import { listJobsTool } from './jobs/listJobs.js';
import { getJobTool } from './jobs/getJob.js';
import { cancelJobTool } from './jobs/cancelJob.js';

// Schedule management tools
import { listSchedulesTool } from './schedules/listSchedules.js';
import { createScheduleTool } from './schedules/createSchedule.js';
import { updateScheduleTool } from './schedules/updateSchedule.js';
import { runScheduleNowTool } from './schedules/runScheduleNow.js';

// Site administration tools
import { listSitesTool } from './sites/listSites.js';
import { getServerInfoTool } from './sites/getServerInfo.js';

// Subscription management tools
import { createSubscriptionTool } from './subscriptions/createSubscription.js';
import { listSubscriptionsTool } from './subscriptions/listSubscriptions.js';
import { deleteSubscriptionTool } from './subscriptions/deleteSubscription.js';

// Content management tools
import { addContentTagsTool } from './content/addContentTags.js';
import { moveContentTool } from './content/moveContent.js';

// Advanced data tools
import { analyzeDataQualityTool } from './data/analyzeDataQuality.js';
import { extractDatasourceDataTool } from './data/extractDatasourceData.js';

// Metadata tools
import { getDatasourceMetadataTool } from './metadata/getDatasourceMetadata.js';

// Bulk operations
import { bulkUpdatePermissionsTool } from './bulk/bulkUpdatePermissions.js';

// Export tools
import { exportWorkbookTool } from './export/exportWorkbook.js';

// Favorites tools
import { addToFavoritesTool } from './favorites/addToFavorites.js';

// Analytics tools
import { getUsageStatisticsTool } from './analytics/getUsageStatistics.js';

// Webhook management tools
import { createWebhookTool } from './webhooks/createWebhook.js';
import { listWebhooksTool } from './webhooks/listWebhooks.js';
import { deleteWebhookTool } from './webhooks/deleteWebhook.js';

// Data alerts tools
import { createDataAlertTool } from './alerts/createDataAlert.js';
import { listDataAlertsTool } from './alerts/listDataAlerts.js';

// Export all tools for registration
export const tools = [
  // Original tools (4 tools) - maintained for compatibility
  originalListDatasourcesTool,
  listFieldsTool,
  queryDatasourceTool,
  readMetadataTool,
  
  // Enhanced User Management (5 tools)
  createUserTool,
  listUsersTool,
  updateUserTool,
  deleteUserTool,
  getUserByNameTool,
  
  // Enhanced Datasource Management (4 tools)
  refreshDatasourceTool,
  updateDatasourceTool,
  deleteDatasourceTool,
  publishDatasourceTool,
  
  // Workbook Management (5 tools)
  listWorkbooksTool,
  publishWorkbookTool,
  downloadWorkbookTool,
  updateWorkbookTool,
  deleteWorkbookTool,
  
  // Project Management (2 tools)
  createProjectTool,
  deleteProjectTool,
  
  // View Management (3 tools)
  listViewsTool,
  getViewImageTool,
  getViewDataTool,
  
  // Permission Management (5 tools)
  grantPermissionsTool,
  revokePermissionsTool,
  listPermissionsTool,
  listContentPermissionsTool,
  copyPermissionsTool,
  
  // Group Management (5 tools)
  createGroupTool,
  listGroupsTool,
  addUserToGroupTool,
  removeUserFromGroupTool,
  deleteGroupTool,
  
  // Job Management (3 tools)
  listJobsTool,
  getJobTool,
  cancelJobTool,
  
  // Schedule Management (4 tools)
  listSchedulesTool,
  createScheduleTool,
  updateScheduleTool,
  runScheduleNowTool,
  
  // Site Administration (2 tools)
  listSitesTool,
  getServerInfoTool,
  
  // Subscription Management (3 tools)
  createSubscriptionTool,
  listSubscriptionsTool,
  deleteSubscriptionTool,
  
  // Content Management (2 tools)
  addContentTagsTool,
  moveContentTool,
  
  // Advanced Data Tools (2 tools)
  analyzeDataQualityTool,
  extractDatasourceDataTool,
  
  // Metadata Tools (1 tool)
  getDatasourceMetadataTool,
  
  // Bulk Operations (1 tool)
  bulkUpdatePermissionsTool,
  
  // Export Tools (1 tool)
  exportWorkbookTool,
  
  // Favorites Tools (1 tool)
  addToFavoritesTool,
  
  // Analytics Tools (1 tool)
  getUsageStatisticsTool,
  
  // Webhook Management (3 tools)
  createWebhookTool,
  listWebhooksTool,
  deleteWebhookTool,
  
  // Data Alerts (2 tools)
  createDataAlertTool,
  listDataAlertsTool,
];

// Summary: 81 total tools
// - Original: 4 tools (maintained for compatibility)
// - Enhanced: 77 additional tools (comprehensive Tableau API coverage)