import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const addContentTagsTool = new Tool({
  name: 'add-content-tags',
  description: `
Add tags to Tableau content (workbooks, data sources, or views) to improve organization, discoverability, and content governance.

**Parameters:**
- \`contentType\`: Type of content to tag - workbook, datasource, or view (required)
- \`contentId\`: ID of the content item (required)
- \`tags\`: Array of tag names to add (required)
- \`contentName\`: Optional content name for reference (will be looked up if not provided)

**Content Types:**
- \`workbook\`: Tag entire workbooks for broad categorization
- \`datasource\`: Tag data sources for data governance
- \`view\`: Tag individual views/dashboards for specific use cases

**Tag Benefits:**
- **Organization**: Group related content across projects
- **Discovery**: Help users find relevant content quickly
- **Governance**: Classify content by sensitivity, quality, or purpose
- **Automation**: Enable automated processes based on tags
- **Reporting**: Generate reports based on content classification

**Tag Categories (Examples):**
- **Functional**: "Finance", "Sales", "Marketing", "Operations"
- **Temporal**: "Daily", "Weekly", "Monthly", "Real-time"
- **Quality**: "Certified", "Draft", "Deprecated", "High-Quality"
- **Audience**: "Executive", "Manager", "Analyst", "Public"
- **Sensitivity**: "Confidential", "Internal", "Public", "PII"
- **Type**: "Dashboard", "Report", "KPI", "Detailed-Analysis"

**Best Practices:**
- Use consistent tag naming conventions
- Implement tag governance policies
- Limit tags to 5-10 per content item
- Use lowercase with hyphens for multi-word tags
- Document tag meanings and usage guidelines

**Example Usage:**
- Workbook tagging: \`{ "contentType": "workbook", "contentId": "wb-123", "tags": ["finance", "monthly", "executive"] }\`
- Data source classification: \`{ "contentType": "datasource", "contentId": "ds-456", "tags": ["certified", "sales-data", "high-quality"] }\`
- View categorization: \`{ "contentType": "view", "contentId": "view-789", "tags": ["kpi", "daily", "operations"] }\`

**Use Cases:**
- Content classification and governance
- Automated content curation
- Search and discovery enhancement
- Compliance and audit support
- Content lifecycle management
`,
  paramsSchema: {
    contentType: z.enum(['workbook', 'datasource', 'view']),
    contentId: z.string().min(1, 'Content ID is required'),
    tags: z.array(z.string().min(1)).min(1, 'At least one tag is required'),
    contentName: z.string().optional(),
  },
  annotations: {
    title: 'Add Content Tags',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ contentType, contentId, tags, contentName }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await addContentTagsTool.logAndExecute({
      requestId,
      args: { contentType, contentId, tags, contentName },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify content exists and get current tags
          let content: any;
          let currentTags: string[] = [];
          let resolvedContentName = contentName || 'Unknown';
          
          try {
            switch (contentType) {
              case 'workbook':
                content = await restApi.workbooksMethods.getWorkbook(restApi.siteId, contentId);
                resolvedContentName = content.name;
                currentTags = content.tags || [];
                break;
              case 'datasource':
                content = await restApi.datasourcesMethods.getDatasource(restApi.siteId, contentId);
                resolvedContentName = content.name;
                currentTags = content.tags || [];
                break;
              case 'view':
                content = await restApi.viewsMethods.getView(restApi.siteId, contentId);
                resolvedContentName = content.name;
                currentTags = content.tags || [];
                break;
            }
          } catch (error) {
            return new Err(`${contentType} with ID '${contentId}' not found`);
          }
          
          // Validate and clean tags
          const cleanedTags = tags.map(tag => tag.toLowerCase().trim()).filter(tag => tag.length > 0);
          const uniqueTags = [...new Set(cleanedTags)];
          
          if (uniqueTags.length === 0) {
            return new Err('No valid tags provided after cleaning');
          }
          
          // Check for duplicate tags
          const newTags = uniqueTags.filter(tag => !currentTags.includes(tag));
          const duplicateTags = uniqueTags.filter(tag => currentTags.includes(tag));
          
          if (newTags.length === 0) {
            return new Ok({
              success: true,
              noChanges: true,
              content: {
                type: contentType,
                id: contentId,
                name: resolvedContentName,
              },
              tags: {
                requested: uniqueTags,
                alreadyPresent: duplicateTags,
                added: [],
                currentTags,
              },
              message: `All requested tags already exist on ${contentType} '${resolvedContentName}'`,
              recommendations: {
                review: 'Review existing tags to ensure they meet current classification needs',
                governance: 'Consider implementing tag governance policies to prevent duplicate tagging',
              },
            });
          }
          
          // Add the new tags
          let result;
          try {
            switch (contentType) {
              case 'workbook':
                result = await restApi.workbooksMethods.addWorkbookTags(restApi.siteId, contentId, newTags);
                break;
              case 'datasource':
                result = await restApi.datasourcesMethods.addDatasourceTags(restApi.siteId, contentId, newTags);
                break;
              case 'view':
                result = await restApi.viewsMethods.addViewTags(restApi.siteId, contentId, newTags);
                break;
            }
          } catch (error) {
            return new Err(`Failed to add tags: ${error}`);
          }
          
          const finalTags = result?.tags || [...currentTags, ...newTags];
          
          // Analyze tag patterns and quality
          const tagAnalysis = {
            totalTags: finalTags.length,
            newlyAdded: newTags.length,
            alreadyPresent: duplicateTags.length,
            averageTagLength: Math.round(finalTags.reduce((sum, tag) => sum + tag.length, 0) / finalTags.length),
            hasMultiWordTags: finalTags.some(tag => tag.includes(' ') || tag.includes('-')),
            hasCategoryTags: finalTags.some(tag => 
              ['finance', 'sales', 'marketing', 'operations', 'hr'].some(cat => tag.includes(cat))
            ),
            hasQualityTags: finalTags.some(tag => 
              ['certified', 'draft', 'deprecated', 'high-quality', 'validated'].includes(tag)
            ),
          };
          
          // Generate tag insights
          const tagCategories = {
            functional: finalTags.filter(tag => 
              ['finance', 'sales', 'marketing', 'operations', 'hr', 'it'].some(func => tag.includes(func))
            ),
            temporal: finalTags.filter(tag => 
              ['daily', 'weekly', 'monthly', 'quarterly', 'annual', 'real-time'].includes(tag)
            ),
            quality: finalTags.filter(tag => 
              ['certified', 'draft', 'deprecated', 'high-quality', 'validated', 'tested'].includes(tag)
            ),
            audience: finalTags.filter(tag => 
              ['executive', 'manager', 'analyst', 'public', 'internal'].includes(tag)
            ),
          };
          
          return new Ok({
            success: true,
            tagsAdded: true,
            content: {
              type: contentType,
              id: contentId,
              name: resolvedContentName,
              projectName: content.project?.name,
              owner: content.owner?.name,
            },
            tags: {
              requested: uniqueTags,
              added: newTags,
              alreadyPresent: duplicateTags,
              finalTags,
              currentCount: finalTags.length,
            },
            analysis: {
              ...tagAnalysis,
              tagCategories,
              categoryDistribution: {
                functional: tagCategories.functional.length,
                temporal: tagCategories.temporal.length,
                quality: tagCategories.quality.length,
                audience: tagCategories.audience.length,
                other: finalTags.length - Object.values(tagCategories).flat().length,
              },
              governanceScore: (() => {
                let score = 0;
                if (tagAnalysis.hasQualityTags) score += 25;
                if (tagAnalysis.hasCategoryTags) score += 25;
                if (finalTags.length >= 3 && finalTags.length <= 8) score += 25;
                if (!finalTags.some(tag => tag.includes(' '))) score += 25; // Prefer hyphenated tags
                return score;
              })(),
            },
            summary: {
              tagsAdded: newTags.length,
              duplicatesSkipped: duplicateTags.length,
              totalTags: finalTags.length,
              contentTagged: true,
              governanceCompliant: tagAnalysis.hasQualityTags && tagAnalysis.hasCategoryTags,
            },
            message: `Successfully added ${newTags.length} new tags to ${contentType} '${resolvedContentName}' (${duplicateTags.length} duplicates skipped)`,
            warnings: {
              ...(finalTags.length > 10 ? 
                { tooManyTags: 'Content has many tags - consider consolidating for better usability' } : {}),
              ...(duplicateTags.length > 0 ? 
                { duplicates: `${duplicateTags.length} tags were already present and skipped` } : {}),
              ...(finalTags.some(tag => tag.includes(' ')) ? 
                { spaceInTags: 'Some tags contain spaces - consider using hyphens for consistency' } : {}),
              ...(finalTags.length < 3 ? 
                { fewTags: 'Content has few tags - consider adding more for better discoverability' } : {}),
            },
            recommendations: {
              ...(tagAnalysis.governanceScore < 75 ? 
                { governance: 'Consider adding quality and category tags for better content governance' } : {}),
              ...(finalTags.length > 8 ? 
                { consolidation: 'Review tags for consolidation opportunities - too many tags can reduce effectiveness' } : {}),
              consistency: 'Use consistent tag naming conventions across all content',
              documentation: 'Document tag meanings and usage guidelines for team consistency',
              automation: 'Consider automated tagging based on content patterns and metadata',
              monitoring: 'Regularly review and clean up tags to maintain organizational effectiveness',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to add content tags: ${error}`);
        }
      },
    });
  },
});