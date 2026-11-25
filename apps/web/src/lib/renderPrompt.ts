import type { ItemsMap, IfcSpaceEntity } from '@skaitch/core/types/ifc';
import { polyArea } from '@skaitch/core/data/query';
export function renderPrompt(args: Record<string, unknown>, items: ItemsMap) {
  const resolveId = (id: string) => items[id] ?? Object.values(items).find(i => i.GlobalId === id);
      const type = String(args.type || 'image');
      const promptText = String(args.prompt);
      const roomId = args.room_id ? String(args.room_id) : '';
      const style = args.style ? String(args.style) : '';
      const timeOfDay = args.time_of_day ? String(args.time_of_day) : '';
      const aspect = args.aspect_ratio ? String(args.aspect_ratio) : '16:9';

      let roomContext = '';
      if (roomId) {
        const room = resolveId(roomId);
        if (room && room.type === 'Room') {
          const sp = room as IfcSpaceEntity;
          const area = polyArea(sp.geom.polygon);
          const name = sp.name || sp.Name || 'espace';
          roomContext = `for a ${name} room of ${area.toFixed(1)}m²`;
        }
      }

      const totalWalls = Object.values(items).filter(i => i.type === 'Wall').length;
      const totalRooms = Object.values(items).filter(i => i.type === 'Room').length;
      const totalDoors = Object.values(items).filter(i => i.type === 'Door').length;
      const totalWindows = Object.values(items).filter(i => i.type === 'Window').length;
      const structureContext = `Storey layout contains ${totalRooms} rooms, ${totalWalls} walls, ${totalDoors} doors, and ${totalWindows} windows.`;

      const finalPrompt = [
        promptText,
        roomContext,
        style ? `in a beautiful ${style} architectural design style` : '',
        timeOfDay ? `shot during ${timeOfDay} lighting` : 'daylight lighting',
        'high-end architectural visualization, realistic render, highly detailed, photorealistic 8k, architecture magazine style, premium materials',
        `[Structure hint: ${structureContext}]`
      ].filter(Boolean).join(', ');

  return { type, style, timeOfDay, aspect, finalPrompt };
}
