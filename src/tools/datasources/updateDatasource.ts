import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const updateDatasourceTool = new Tool({
  name: 'update-datasource',
  description: `
Update properties of an existing published data source in Tableau Cloud/Server. This allows you to modify metadata and settings without republishing.

**Parameters:**
- \`datasourceId\`: ID of the data source to update (required)
- \`name\`: New name for the data source (optional)
- \`description\`: New description for the data source (optional)
- \`projectId\`: ID of the project to move the data source to (optional)
- \`isCertified\`: Mark data source as certified or remove certification (optional)
- \`certificationNote\`: Note explaining certification status (optional)
- \`encryptExtracts\`: Whether to encrypt extract data (optional)

**Updatable Properties:**
- **Name**: Change the display name of the data source
- **Description**: Update or add descriptive text about the data source
- **Project**: Move data source to a different project
- **Certification**: Mark as certified for quality assurance
- **Extract Encryption**: Enable/disable extract data encryption

**Certification Management:**
- **Quality Assurance**: Certified data sources are marked as trusted
- **User Guidance**: Helps users identify reliable data sources
- **Governance**: Supports data governance and quality programs
- **Documentation**: Certification notes explain quality standards

**Project Movement:**
- Moving data sources between projects affects permissions
- Users need appropriate permissions in both source and destination projects
- Consider permission inheritance when moving content
- Notify users of project changes that affect their access

**Security Considerations:**
- **Extract Encryption**: Protects sensitive data in extracts
- **Project Security**: Different projects may have different security requirements
- **Access Control**: Project movement may change who can access the data source

**Example Usage:**
- Rename data source: \`{ "datasourceId": "ds-123", "name": "Updated Sales Data" }\`
- Move to project: \`{ "datasourceId": "ds-123", "projectId": "proj-456" }\`
- Certify data source: \`{ "datasourceId": "ds-123", "isCertified": true, "certificationNote": "Validated by Data Quality Team" }\`
- Enable encryption: \`{ "datasourceId": "ds-123", "encryptExtracts": true }\`
- Multiple updates: \`{ "datasourceId": "ds-123", "name": "Certified Sales Data", "description": "Quality-assured sales data", "isCertified": true }\`

**Best Practices:**
- Use descriptive names that reflect data content and quality
- Keep descriptions current and meaningful
- Plan project moves carefully to maintain user access
- Use certification to indicate data quality and trustworthiness
- Enable encryption for sensitive data sources
- Document all changes for audit and governance purposes
`,
  paramsSchema: {
    datasourceId: z.string().min(1, 'Data source ID is required'),
    name: z.string().optional(),
    description: z.string().optional(),
    projectId: z.string().optional(),
    isCertified: z.boolean().optional(),
    certificationNote: z.string().optional(),
    encryptExtracts: z.boolean().optional(),
  },
  annotations: {
    title: 'Update Data Source',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    datasourceId, 
    name, 
    description, 
    projectId, 
    isCertified, 
    certificationNote, 
    encryptExtracts 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await updateDatasourceTool.logAndExecute({
      requestId,
      args: { datasourceId, name, description, projectId, isCertified, certificationNote, encryptExtracts },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify data source exists and get current details
          let originalDatasource;
          try {
            originalDatasource = await restApi.datasourcesMethods.getDatasource(restApi.siteId, datasourceId);
          } catch (error) {
            return new Err(`Data source with ID '${datasourceId}' not found`);
          }
          
          // Verify destination project exists if moving
          let destinationProject;
          if (projectId && projectId !== originalDatasource.project?.id) {
            try {
              const projects = await restApi.projectsMethods.listProjects(restApi.siteId, `id:eq:${projectId}`);
              destinationProject = projects.projects[0];
              if (!destinationProject) {
                return new Err(`Destination project with ID '${projectId}' not found`);
              }
            } catch (error) {
              return new Err(`Destination project with ID '${projectId}' not found`);
            }
          }
          
          // Check if any updates are actually being made
          const hasChanges = name !== undefined || 
                           description !== undefined || 
                           projectId !== undefined || 
                           isCertified !== undefined || 
                           certificationNote !== undefined || 
                           encryptExtracts !== undefined;
          
          if (!hasChanges) {
            return new Err('No update parameters provided - specify at least one property to update');
          }
          
          // Validate certification note requirement
          if (isCertified === true && !certificationNote && !originalDatasource.certificationNote) {
            return new Err('Certification note is recommended when certifying a data source');
          }
          
          // Update the data source
          const updatedDatasource = await restApi.datasourcesMethods.updateDatasource(restApi.siteId, datasourceId, {
            name,
            description,
            projectId,
            isCertified,
            certificationNote,
            encryptExtracts,
          });
          
          // Analyze changes made
          const changes = {
            nameChanged: name !== undefined && name !== originalDatasource.name,
            descriptionChanged: description !== undefined && description !== (originalDatasource.description || ''),
            projectChanged: projectId !== undefined && projectId !== originalDatasource.project?.id,
            certificationChanged: isCertified !== undefined && isCertified !== originalDatasource.isCertified,
            certificationNoteChanged: certificationNote !== undefined && certificationNote !== (originalDatasource.certificationNote || ''),
            encryptionChanged: encryptExtracts !== undefined && encryptExtracts !== originalDatasource.encryptExtracts,
          };
          
          const changeCount = Object.values(changes).filter(Boolean).length;
          
          // Analyze certification status
          const certificationStatus = (() => {
            if (changes.certificationChanged) {
              return isCertified ? 'Newly Certified' : 'Certification Removed';
            }
            if (updatedDatasource.isCertified) {
              return 'Remains Certified';
            }
            return 'Not Certified';
          })();
          
          // Analyze security changes
          const securityEnhanced = changes.encryptionChanged && encryptExtracts;
          const securityReduced = changes.encryptionChanged && !encryptExtracts;
          
          return new Ok({
            success: true,
            datasource: {
              id: updatedDatasource.id,
              name: updatedDatasource.name,
              description: updatedDatasource.description,
              type: updatedDatasource.type,
              contentUrl: updatedDatasource.contentUrl,
              projectId: updatedDatasource.project?.id,
              projectName: updatedDatasource.project?.name,
              ownerId: updatedDatasource.owner?.id,
              ownerName: updatedDatasource.owner?.name,
              hasExtracts: updatedDatasource.hasExtracts,
              isCertified: updatedDatasource.isCertified,
              certificationNote: updatedDatasource.certificationNote,
              encryptExtracts: updatedDatasource.encryptExtracts,
              size: updatedDatasource.size,
              createdAt: updatedDatasource.createdAt,
              updatedAt: updatedDatasource.updatedAt,
            },
            changes: {
              totalChanges: changeCount,
              nameChanged: changes.nameChanged,
              descriptionChanged: changes.descriptionChanged,
              projectChanged: changes.projectChanged,
              certificationChanged: changes.certificationChanged,
              certificationNoteChanged: changes.certificationNoteChanged,
              encryptionChanged: changes.encryptionChanged,
            },
            summary: {
              originalName: originalDatasource.name,
              newName: updatedDatasource.name,
              originalProject: originalDatasource.project?.name,
              newProject: updatedDatasource.project?.name,
              projectMoved: changes.projectChanged,
              certificationStatus,
              securityEnhanced,
              securityReduced,
            },
            details: {
              datasourceId: updatedDatasource.id,
              originalProjectId: originalDatasource.project?.id,
              newProjectId: updatedDatasource.project?.id,
              destinationProjectName: destinationProject?.name,
              lastModified: updatedDatasource.updatedAt,
              hasDescription: !!updatedDatasource.description,
              isCertified: updatedDatasource.isCertified,
              hasCertificationNote: !!updatedDatasource.certificationNote,
              extractsEncrypted: updatedDatasource.encryptExtracts,
              hasExtracts: updatedDatasource.hasExtracts,
            },
            qualityIndicators: {
              certificationStatus,
              hasDescription: !!updatedDatasource.description,
              hasCertificationNote: !!updatedDatasource.certificationNote,
              isEncrypted: updatedDatasource.encryptExtracts,
              qualityScore: (() => {
                let score = 0;
                if (updatedDatasource.isCertified) score += 30;
                if (updatedDatasource.description) score += 20;
                if (updatedDatasource.certificationNote) score += 20;
                if (updatedDatasource.encryptExtracts && updatedDatasource.hasExtracts) score += 20;
                if (updatedDatasource.tags && updatedDatasource.tags.length > 0) score += 10;
                return score;
              })(),
            },
            message: `Successfully updated data source '${updatedDatasource.name}' with ${changeCount} change${changeCount !== 1 ? 's' : ''}`,
            warnings: {
              ...(changes.projectChanged ? 
                { permissionImpact: 'Moving data source to different project may affect user permissions' } : {}),
              ...(securityReduced ? 
                { securityReduced: 'Extract encryption has been disabled - consider security implications' } : {}),
              ...(changes.certificationChanged && !isCertified ? 
                { certificationRemoved: 'Data source certification has been removed - users may question data quality' } : {}),
            },
            recommendations: {
              ...(changes.projectChanged ? 
                { permissionReview: 'Review and update data source permissions after project move' } : {}),
              ...(changes.nameChanged ? 
                { notifyUsers: 'Notify users of data source name changes to avoid confusion' } : {}),
              ...(securityEnhanced ? 
                { securityBenefit: 'Extract encryption enabled - enhanced data security for sensitive content' } : {}),
              ...(changes.certificationChanged && isCertified ? 
                { certificationCommunication: 'Communicate certification status to users to build trust in data quality' } : {}),
              ...(updatedDatasource.isCertified && !updatedDatasource.certificationNote ? 
                { addCertificationNote: 'Consider adding a certification note to explain quality standards' } : {}),
              versionControl: 'Document data source changes for audit and version control purposes',
              governance: 'Ensure changes align with organizational data governance policies',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to update data source: ${error}`);
        }
      },
    });
  },
});