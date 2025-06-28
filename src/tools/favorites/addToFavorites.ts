import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const addToFavoritesTool = new Tool({
  name: 'add-to-favorites',
  description: `
Add content to a user's favorites list in Tableau Cloud/Server. Favorites provide quick access to frequently used workbooks, views, and data sources.

**Parameters:**
- \`contentType\`: Type of content to favorite - workbook, view, or datasource (required)
- \`contentId\`: ID of the content to add to favorites (required)
- \`userId\`: ID of the user (optional, defaults to current user)
- \`label\`: Custom label for the favorite (optional)

**Supported Content Types:**
- **Workbook**: Add entire workbooks to favorites
- **View**: Add specific views or dashboards to favorites
- **Data Source**: Add published data sources to favorites

**Favorites Management:**
- **Quick Access**: Favorites appear in user's personal menu for fast navigation
- **Organization**: Users can organize favorites with custom labels
- **Sharing**: Favorite lists are personal to each user
- **Cross-Project**: Favorites can span multiple projects and sites

**User Experience Benefits:**
- **Reduced Navigation**: Direct access to frequently used content
- **Productivity**: Faster access to daily work items
- **Personalization**: Customize Tableau interface for individual workflows
- **Bookmarking**: Save important content for future reference

**Content Discovery:**
- **Usage Patterns**: Popular content often becomes favorited
- **Recommendations**: System can suggest content based on favorites
- **Team Collaboration**: See what content team members find valuable
- **Content Promotion**: Frequently favorited content indicates high value

**Example Usage:**
- Favorite workbook: \`{ "contentType": "workbook", "contentId": "wb-123" }\`
- Favorite specific view: \`{ "contentType": "view", "contentId": "view-456" }\`
- Favorite with label: \`{ "contentType": "datasource", "contentId": "ds-789", "label": "Weekly Sales Data" }\`
- For specific user: \`{ "contentType": "workbook", "contentId": "wb-101", "userId": "user-456" }\`

**Use Cases:**
- **Daily Dashboards**: Quick access to operational dashboards
- **Key Reports**: Bookmark important monthly/quarterly reports
- **Data Sources**: Easy access to frequently used data connections
- **Team Standards**: Promote consistent use of approved content
- **Training**: Guide new users to important content

**Administrative Benefits:**
- **Usage Analytics**: Track which content users find most valuable
- **Content Curation**: Identify high-value content for promotion
- **User Adoption**: Encourage regular use of Tableau content
- **System Optimization**: Focus resources on frequently accessed content

**Best Practices:**
- Use descriptive labels for better organization
- Regular cleanup of outdated favorites
- Share favorite lists as informal content recommendations
- Organize favorites by frequency of use or project
- Encourage team members to favorite shared resources
`,
  paramsSchema: {
    contentType: z.enum(['workbook', 'view', 'datasource']),
    contentId: z.string().min(1, 'Content ID is required'),
    userId: z.string().optional(),
    label: z.string().optional(),
  },
  annotations: {
    title: 'Add to Favorites',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    contentType, 
    contentId, 
    userId, 
    label 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await addToFavoritesTool.logAndExecute({
      requestId,
      args: { contentType, contentId, userId, label },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Use current user if no userId specified
          const targetUserId = userId || restApi.userId; // Assuming userId is available on restApi
          
          // Verify content exists and get details
          let contentDetails: any = {};
          try {
            switch (contentType) {
              case 'workbook':
                const workbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, contentId);
                contentDetails = {
                  name: workbook.name,
                  type: 'Workbook',
                  projectName: workbook.project?.name,
                  ownerName: workbook.owner?.name,
                  size: workbook.size,
                  viewCount: workbook.views?.length || 0,
                  updatedAt: workbook.updatedAt,
                };
                break;
              case 'view':
                const view = await restApi.viewsMethods.getView(restApi.siteId, contentId);
                contentDetails = {
                  name: view.name,
                  type: 'View',
                  workbookName: view.workbook?.name,
                  projectName: view.project?.name,
                  contentUrl: view.contentUrl,
                };
                break;
              case 'datasource':
                const datasource = await restApi.datasourcesMethods.getDatasource(restApi.siteId, contentId);
                contentDetails = {
                  name: datasource.name,
                  type: 'Data Source',
                  dataSourceType: datasource.type,
                  projectName: datasource.project?.name,
                  hasExtracts: datasource.hasExtracts,
                  isCertified: datasource.isCertified,
                  size: datasource.size,
                };
                break;
            }
          } catch (error) {
            return new Err(`${contentType} with ID '${contentId}' not found`);
          }
          
          // Verify user exists if userId was specified
          let userDetails: any = {};
          if (userId) {
            try {
              const users = await restApi.usersMethods.listUsers(restApi.siteId, `id:eq:${targetUserId}`);
              const user = users.users[0];
              if (!user) {
                return new Err(`User with ID '${targetUserId}' not found`);
              }
              userDetails = {
                name: user.name,
                fullName: user.fullName,
                email: user.email,
                siteRole: user.siteRole,
              };
            } catch (error) {
              return new Err(`User with ID '${targetUserId}' not found`);
            }
          }
          
          // Check if content is already in favorites
          let alreadyFavorite = false;
          try {
            const existingFavorites = await restApi.favoritesMethods.listUserFavorites(restApi.siteId, targetUserId);
            alreadyFavorite = existingFavorites.some((fav: any) => 
              fav.contentType === contentType && fav.contentId === contentId
            );
          } catch (error) {
            // Continue if we can't check existing favorites
          }
          
          if (alreadyFavorite) {
            return new Err(`${contentDetails.type} '${contentDetails.name}' is already in user's favorites`);
          }
          
          // Add to favorites
          const favoriteItem = await restApi.favoritesMethods.addToFavorites(restApi.siteId, {
            userId: targetUserId,
            contentType,
            contentId,
            label: label || contentDetails.name,
          });
          
          // Analyze favorite characteristics
          const favoriteAnalysis = {
            contentPopularity: estimateContentPopularity(contentDetails),
            userBenefit: assessUserBenefit(contentType, contentDetails),
            accessFrequency: estimateAccessFrequency(contentType, contentDetails),
            organizationalValue: calculateOrganizationalValue(contentDetails),
          };
          
          // Generate usage recommendations
          const usageRecommendations = generateUsageRecommendations(contentType, contentDetails, favoriteAnalysis);
          
          return new Ok({
            success: true,
            addedToFavorites: true,
            favorite: {
              id: favoriteItem.id,
              contentType,
              contentId,
              contentName: contentDetails.name,
              label: label || contentDetails.name,
              userId: targetUserId,
              createdAt: new Date().toISOString(),
            },
            content: contentDetails,
            user: userDetails,
            analysis: favoriteAnalysis,
            benefits: {
              quickAccess: 'Content now available in favorites menu for fast navigation',
              productivity: 'Reduced time to access frequently used content',
              personalization: 'Customized Tableau interface for improved workflow',
              discovery: 'Easy return to valuable content for future use',
            },
            impact: {
              userExperience: 'Improved',
              navigationEfficiency: favoriteAnalysis.accessFrequency === 'High' ? 'Significant' : 'Moderate',
              workflowOptimization: contentType === 'view' ? 'High' : 'Medium',
              contentEngagement: 'Increased',
            },
            summary: {
              contentName: contentDetails.name,
              contentType: contentDetails.type,
              projectName: contentDetails.projectName || 'Unknown',
              userBenefit: favoriteAnalysis.userBenefit,
              accessImprovement: 'Direct access from favorites menu',
              favoriteLabel: label || contentDetails.name,
              addedSuccessfully: true,
            },
            message: `Successfully added ${contentDetails.type.toLowerCase()} '${contentDetails.name}' to favorites${userId ? ` for user '${userDetails.name || 'Unknown'}'` : ''}`,
            recommendations: usageRecommendations,
            nextSteps: {
              access: 'Find favorited content in the favorites section of the main navigation',
              organization: 'Consider organizing favorites with descriptive labels and categories',
              sharing: 'Share valuable content discoveries with team members',
              maintenance: 'Regularly review and clean up favorites list to keep it current',
              exploration: 'Use favorites as starting points for discovering related content',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to add content to favorites: ${error}`);
        }
      },
    });
  },
});

// Helper functions
function estimateContentPopularity(contentDetails: any): string {
  // Simplified popularity estimation based on content characteristics
  let popularityScore = 0;
  
  if (contentDetails.size > 10000000) popularityScore += 1; // Large content often means more data/complexity
  if (contentDetails.viewCount > 5) popularityScore += 2; // Multiple views suggest comprehensive content
  if (contentDetails.isCertified) popularityScore += 2; // Certified content is typically high-value
  if (contentDetails.hasExtracts) popularityScore += 1; // Extract-based content often used regularly
  
  if (popularityScore >= 4) return 'High';
  if (popularityScore >= 2) return 'Medium';
  return 'Standard';
}

function assessUserBenefit(contentType: string, contentDetails: any): string {
  switch (contentType) {
    case 'view':
      return 'High'; // Views are directly consumable and provide immediate value
    case 'workbook':
      return contentDetails.viewCount > 3 ? 'High' : 'Medium'; // Workbooks with many views offer more value
    case 'datasource':
      return contentDetails.isCertified ? 'High' : 'Medium'; // Certified data sources are more reliable
    default:
      return 'Medium';
  }
}

function estimateAccessFrequency(contentType: string, contentDetails: any): string {
  // Estimate how often the user might access this content
  if (contentType === 'view') return 'High'; // Views are typically accessed frequently
  if (contentType === 'datasource' && contentDetails.hasExtracts) return 'Medium'; // Extract data sources used regularly
  if (contentType === 'workbook' && contentDetails.viewCount > 5) return 'Medium'; // Comprehensive workbooks
  return 'Low';
}

function calculateOrganizationalValue(contentDetails: any): string {
  let value = 0;
  
  if (contentDetails.isCertified) value += 3; // Certified content has organizational approval
  if (contentDetails.size > 5000000) value += 1; // Substantial content investment
  if (contentDetails.viewCount > 10) value += 2; // Comprehensive content delivery
  if (contentDetails.hasExtracts) value += 1; // Processed/prepared data
  
  if (value >= 5) return 'High';
  if (value >= 3) return 'Medium';
  return 'Standard';
}

function generateUsageRecommendations(contentType: string, contentDetails: any, analysis: any): any {
  const recommendations: any = {
    access: 'Use favorites menu for quick navigation to this content',
    frequency: 'Consider bookmarking related content for comprehensive workflow support',
  };
  
  if (contentType === 'view') {
    recommendations.interaction = 'Explore filters and parameters for deeper insights';
    recommendations.sharing = 'Share direct links to valuable views with team members';
  }
  
  if (contentType === 'workbook' && contentDetails.viewCount > 5) {
    recommendations.exploration = 'Explore different views within this workbook for comprehensive analysis';
    recommendations.collaboration = 'Consider subscribing to regular updates if content changes frequently';
  }
  
  if (contentType === 'datasource' && contentDetails.isCertified) {
    recommendations.reliability = 'Use this certified data source for authoritative analysis';
    recommendations.adoption = 'Recommend this data source to team members for consistent data usage';
  }
  
  if (analysis.organizationalValue === 'High') {
    recommendations.governance = 'Follow organizational guidelines for using high-value content';
    recommendations.stewardship = 'Report any issues or suggest improvements for this important content';
  }
  
  return recommendations;
}