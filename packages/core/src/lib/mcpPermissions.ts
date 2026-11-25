/** Check project and account grants before executing an MCP tool. */
export function authorizeMcpTool(
  name: string, args: Record<string, unknown>, activeProjectId: string | null,
  permissions: Record<string, string>, accountAccess?: string,
) {
  if (name === 'list_projects' || name === 'search_tools' || name === 'load_skill') return;
  const projectId = name === 'select_project' ? String(args.project_id || '') : activeProjectId;
  const permission = projectId ? (accountAccess || permissions[projectId]) : 'none';
  if (permission !== 'read' && permission !== 'write') throw new Error('Access denied to project');
  const readOnly = ['execute_script', 'get_view', 'set_view', 'capture_view', 'select_project', 'list_spatial_structure', 'select_storey', 'get_storey_floorplan', 'get_background_geometry',
    'get_ifc_scene_overview', 'list_opening_types', 'list_object_types', 'list_ifc_entities', 'get_element_properties', 'get_survey', 'get_survey_photo', 'get_wall_connections',
    'export_ifc', 'measure_distance', 'export_sheet'];
  if (!readOnly.includes(name) && permission !== 'write') throw new Error('Project is read-only');
}
