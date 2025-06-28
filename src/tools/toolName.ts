// Core user management tools  
export type UserManagementTools =
  | 'create-user'
  | 'update-user'
  | 'delete-user'
  | 'get-user-by-name'
  | 'search-users';

// Core group management tools
export type GroupManagementTools =
  | 'create-group'
  | 'add-user-to-group'
  | 'remove-user-from-group'
  | 'list-groups';

// Core content management tools
export type ContentManagementTools =
  | 'list-workbooks'
  | 'publish-workbook'
  | 'download-workbook'
  | 'move-workbook'
  | 'get-workbook-views'
  | 'list-datasources'
  | 'publish-datasource'
  | 'download-datasource'
  | 'move-datasource'
  | 'refresh-datasource-now'
  | 'create-project'
  | 'search-projects'
  | 'get-project-by-name'
  | 'list-views'
  | 'get-view-image'
  | 'search-content'
  | 'search-workbooks'
  | 'search-datasources';

// Permission management tools
export type PermissionTools =
  | 'grant-permissions'
  | 'revoke-permissions'
  | 'list-content-permissions';

// Operational tools
export type OperationalTools =
  | 'list-jobs'
  | 'get-job-status'
  | 'cancel-job'
  | 'list-schedules'
  | 'create-schedule'
  | 'list-subscriptions'
  | 'create-subscription'
  | 'add-tags-to-workbook'
  | 'remove-tags-from-workbook'
  | 'add-tags-to-datasource';

// Site administration tools
export type SiteAdminTools =
  | 'update-site'
  | 'list-webhooks'
  | 'create-webhook'
  | 'delete-webhook';

// Data access tools (from official implementation)
export type DataAccessTools =
  | 'list-fields'
  | 'query-datasource'
  | 'read-metadata';

// Additional tools
export type AdditionalTools =
  | 'list-favorites'
  | 'add-favorite';

export type ToolName = 
  | UserManagementTools
  | GroupManagementTools
  | ContentManagementTools
  | PermissionTools
  | OperationalTools
  | SiteAdminTools
  | DataAccessTools
  | AdditionalTools;

export function isToolName(name: string): name is ToolName {
  return toolNames.includes(name as ToolName);
}

// Export all tool names for validation and configuration
export const toolNames: ToolName[] = [
  // User management
  'create-user',
  'update-user', 
  'delete-user',
  'get-user-by-name',
  'search-users',
  
  // Group management
  'create-group',
  'add-user-to-group',
  'remove-user-from-group',
  'list-groups',
  
  // Content management
  'list-workbooks',
  'publish-workbook',
  'download-workbook',
  'move-workbook',
  'get-workbook-views',
  'list-datasources',
  'publish-datasource',
  'download-datasource',
  'move-datasource',
  'refresh-datasource-now',
  'create-project',
  'search-projects',
  'get-project-by-name',
  'list-views',
  'get-view-image',
  'search-content',
  'search-workbooks',
  'search-datasources',
  
  // Permissions
  'grant-permissions',
  'revoke-permissions',
  'list-content-permissions',
  
  // Operations
  'list-jobs',
  'get-job-status',
  'cancel-job',
  'list-schedules',
  'create-schedule',
  'list-subscriptions',
  'create-subscription',
  'add-tags-to-workbook',
  'remove-tags-from-workbook',
  'add-tags-to-datasource',
  
  // Site admin
  'update-site',
  'list-webhooks',
  'create-webhook',
  'delete-webhook',
  
  // Data access
  'list-fields',
  'query-datasource',
  'read-metadata',
  
  // Additional
  'list-favorites',
  'add-favorite',
];