import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const createUserTool = new Tool({
  name: 'create-user',
  description: `
Create a new user account in Tableau Cloud/Server. This adds a user to the site with specified permissions and settings.

**Parameters:**
- \`name\`: Username for the account (required)
- \`siteRole\`: Site role determining permissions (required)
- \`email\`: Email address for the user (optional, recommended)
- \`fullName\`: Full display name (optional)
- \`password\`: Password for local authentication (optional)
- \`authSetting\`: Authentication method - local, saml, or openid (optional, default: local)

**Site Roles and Permissions:**
- **Site Administrator**: Full site management capabilities
- **Creator**: Publish, create, and manage content
- **Explorer (can publish)**: View, interact, and publish limited content
- **Explorer**: View and interact with published content
- **Viewer**: View published content only
- **Unlicensed**: No access to site content

**Authentication Methods:**
- **Local**: Username/password authentication managed by Tableau
- **SAML**: Single Sign-On via SAML identity provider
- **OpenID**: OpenID Connect authentication

**User Account Setup:**
- **Username**: Unique identifier for login (cannot be changed)
- **Email**: Used for notifications and password recovery
- **Full Name**: Display name shown in Tableau interface
- **Site Role**: Determines feature access and licensing requirements

**License Consumption:**
- **Licensed Roles**: Site Admin, Creator, Explorer require licenses
- **Viewer Role**: May require license depending on site configuration
- **Unlicensed**: Does not consume licenses but has no content access

**Example Usage:**
- Basic user: \`{ "name": "jsmith", "siteRole": "Explorer", "email": "jsmith@company.com" }\`
- Full setup: \`{ "name": "amanager", "siteRole": "Creator", "email": "amanager@company.com", "fullName": "Alice Manager", "authSetting": "saml" }\`
- Admin user: \`{ "name": "tableauadmin", "siteRole": "SiteAdministrator", "email": "admin@company.com", "fullName": "Tableau Administrator" }\`
- Local auth: \`{ "name": "localuser", "siteRole": "Viewer", "email": "local@company.com", "password": "SecurePass123", "authSetting": "local" }\`

**Best Practices:**
- Use consistent naming conventions for usernames
- Always provide email addresses for communication
- Choose appropriate site roles based on user needs
- Consider license implications when assigning roles
- Use SSO authentication when available for better security
- Document user creation for audit and compliance purposes

**Security Considerations:**
- Strong password requirements for local authentication
- Email verification for account activation
- Appropriate site role assignment to limit unnecessary access
- Regular review of user accounts and permissions
`,
  paramsSchema: {
    name: z.string().min(1, 'Username is required'),
    siteRole: z.enum([
      'SiteAdministrator',
      'Creator', 
      'ExplorerCanPublish',
      'Explorer',
      'Viewer',
      'Unlicensed'
    ]),
    email: z.string().email().optional(),
    fullName: z.string().optional(),
    password: z.string().optional(),
    authSetting: z.enum(['local', 'saml', 'openid']).optional(),
  },
  annotations: {
    title: 'Create User',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    name, 
    siteRole, 
    email, 
    fullName, 
    password, 
    authSetting = 'local' 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await createUserTool.logAndExecute({
      requestId,
      args: { name, siteRole, email, fullName, password, authSetting },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Validate username uniqueness
          try {
            const existingUsers = await restApi.usersMethods.listUsers(restApi.siteId, `name:eq:${name}`);
            if (existingUsers.users.length > 0) {
              return new Err(`User with username '${name}' already exists`);
            }
          } catch (error) {
            // Continue if we can't check existing users
          }
          
          // Validate email uniqueness if provided
          if (email) {
            try {
              const existingUsers = await restApi.usersMethods.listUsers(restApi.siteId, `email:eq:${email}`);
              if (existingUsers.users.length > 0) {
                return new Err(`User with email '${email}' already exists`);
              }
            } catch (error) {
              // Continue if we can't check existing users
            }
          }
          
          // Validate password requirements for local auth
          if (authSetting === 'local' && password) {
            if (password.length < 8) {
              return new Err('Password must be at least 8 characters long for local authentication');
            }
          }
          
          // Create the user
          const createdUser = await restApi.usersMethods.createUser(restApi.siteId, {
            name,
            siteRole,
            email,
            fullName,
            password,
            authSetting,
          });
          
          // Analyze user configuration
          const rolePermissions = {
            SiteAdministrator: {
              level: 'Administrative',
              canPublish: true,
              canManageUsers: true,
              canManageProjects: true,
              canManageExtracts: true,
              requiresLicense: true,
              description: 'Full site administration capabilities',
            },
            Creator: {
              level: 'Author',
              canPublish: true,
              canManageUsers: false,
              canManageProjects: false,
              canManageExtracts: true,
              requiresLicense: true,
              description: 'Create and publish content',
            },
            ExplorerCanPublish: {
              level: 'Limited Author',
              canPublish: true,
              canManageUsers: false,
              canManageProjects: false,
              canManageExtracts: false,
              requiresLicense: true,
              description: 'View, interact, and publish limited content',
            },
            Explorer: {
              level: 'Consumer',
              canPublish: false,
              canManageUsers: false,
              canManageProjects: false,
              canManageExtracts: false,
              requiresLicense: true,
              description: 'View and interact with content',
            },
            Viewer: {
              level: 'Read-only',
              canPublish: false,
              canManageUsers: false,
              canManageProjects: false,
              canManageExtracts: false,
              requiresLicense: false, // May vary by site
              description: 'View content only',
            },
            Unlicensed: {
              level: 'No Access',
              canPublish: false,
              canManageUsers: false,
              canManageProjects: false,
              canManageExtracts: false,
              requiresLicense: false,
              description: 'No content access',
            },
          };
          
          const roleInfo = rolePermissions[siteRole as keyof typeof rolePermissions];
          
          // Determine authentication setup
          const authenticationSetup = {
            method: authSetting,
            requiresPassword: authSetting === 'local',
            usesSso: ['saml', 'openid'].includes(authSetting),
            passwordProvided: !!password,
            emailVerificationNeeded: !!email && authSetting === 'local',
          };
          
          // Calculate setup completeness
          const setupCompleteness = (() => {
            let score = 0;
            if (name) score += 20;
            if (siteRole) score += 30;
            if (email) score += 25;
            if (fullName) score += 15;
            if (authenticationSetup.requiresPassword && authenticationSetup.passwordProvided) score += 10;
            return score;
          })();
          
          return new Ok({
            success: true,
            userCreated: true,
            user: {
              id: createdUser.id,
              name: createdUser.name,
              fullName: createdUser.fullName,
              email: createdUser.email,
              siteRole: createdUser.siteRole,
              authSetting: createdUser.authSetting,
              locale: createdUser.locale,
              language: createdUser.language,
            },
            roleConfiguration: {
              siteRole,
              permissionLevel: roleInfo.level,
              capabilities: {
                canPublish: roleInfo.canPublish,
                canManageUsers: roleInfo.canManageUsers,
                canManageProjects: roleInfo.canManageProjects,
                canManageExtracts: roleInfo.canManageExtracts,
              },
              licensing: {
                requiresLicense: roleInfo.requiresLicense,
                description: roleInfo.description,
              },
            },
            authentication: authenticationSetup,
            setup: {
              completeness: `${setupCompleteness}%`,
              hasEmail: !!email,
              hasFullName: !!fullName,
              hasPassword: authenticationSetup.passwordProvided,
              readyForUse: setupCompleteness >= 75,
            },
            summary: {
              username: name,
              displayName: fullName || name,
              emailAddress: email || 'Not provided',
              siteRole,
              authMethod: authSetting,
              licenseRequired: roleInfo.requiresLicense,
              setupComplete: setupCompleteness >= 75,
            },
            message: `Successfully created user '${name}' with ${siteRole} role`,
            warnings: {
              ...(setupCompleteness < 75 ? 
                { incompleteSetup: 'User setup is incomplete - consider adding missing information' } : {}),
              ...(siteRole === 'Unlicensed' ? 
                { noAccess: 'User has no access to site content - assign appropriate role when ready' } : {}),
              ...(authSetting === 'local' && !password ? 
                { noPassword: 'Local authentication user created without password - user cannot log in until password is set' } : {}),
              ...(roleInfo.requiresLicense ? 
                { licenseRequired: 'This role requires a license - ensure license capacity is available' } : {}),
              ...(!email ? 
                { noEmail: 'No email provided - user will not receive notifications or password recovery options' } : {}),
            },
            recommendations: {
              ...(!email ? 
                { addEmail: 'Add email address for notifications and account recovery' } : {}),
              ...(!fullName ? 
                { addDisplayName: 'Add full name for better user identification' } : {}),
              ...(authSetting === 'local' && !password ? 
                { setPassword: 'Set password for local authentication users' } : {}),
              ...(roleInfo.requiresLicense ? 
                { licenseManagement: 'Monitor license usage after adding licensed users' } : {}),
              groupAssignment: 'Consider adding user to appropriate groups for permission management',
              contentAccess: 'Grant permissions to projects and content as needed',
              training: 'Provide user training appropriate for their role level',
              documentation: 'Document user creation for audit and compliance purposes',
              welcomeCommunication: 'Send welcome communication with login instructions and resources',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to create user: ${error}`);
        }
      },
    });
  },
});