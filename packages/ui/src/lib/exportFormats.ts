import { requestBim } from './bimService';
import type { ItemsMap, IfcEntity, IfcWallEntity, IfcSpaceEntity, IfcDoorEntity, IfcWindowEntity } from '@skaitch/core/types/ifc';

// ── Helper to trigger native file downloads in browser ───────────────────────
export function triggerFileDownload(content: string | Blob, filename: string, mimeType: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ── 1. Export as BIMJSON (.json) ──────────────────────────────────────────────
export async function exportToBimJSON(items: ItemsMap, projectId: string, projectName: string) {
  const text = await requestBim<string>('export-json', { items, projectId, projectName });
  triggerFileDownload(text, `${projectName.replace(/\s+/g, '_')}_model.json`, 'application/json');
}

export function exportToDXF(items: ItemsMap, projectName: string): Promise<string> {
  return requestBim('export-dxf', { items, projectName });
}

export function exportToPDF(items: ItemsMap, storeyName: string, projectName: string) {
  const svgEl = document.querySelector('#plan-svg-canvas') as SVGSVGElement | null;
  if (!svgEl) {
    alert("Canvas element not found for export.");
    return;
  }
  
  try {
    // Clone SVG node to prevent modifications to UI
    const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
    
    // Get view attributes
    const width = svgEl.clientWidth || 1200;
    const height = svgEl.clientHeight || 700;
    
    clonedSvg.setAttribute("width", String(width));
    clonedSvg.setAttribute("height", String(height));
    
    // For PDF, we always force a clean, printable light theme style
    const bgVal = "#ffffff";
    const panelVal = "#fafaf9";
    const panel2Val = "#f4f4f2";
    const borderVal = "#e7e5e2";
    const borderStrongVal = "#d4d2cf";
    const borderFaintVal = "#efedea";
    
    const inkVal = "#0c0c0d";
    const ink2Val = "#4b4b50";
    const ink3Val = "#8a8a90";
    const ink4Val = "#b8b8be";
    
    const accentVal = "oklch(0.55 0.12 235)";
    
    const cRoomVal = "oklch(0.86 0.05 145)";
    const cWallVal = "#525252";
    const cDoorVal = "oklch(0.66 0.13 35)";
    const cWindowVal = "oklch(0.72 0.08 215)";
    const cFurnitureVal = "oklch(0.7 0.07 280)";

    // Remove all editor-only overlays (grid lines, selection handles, coordinate displays, guides)
    clonedSvg.querySelectorAll(".editor-overlay").forEach(el => el.remove());

    // Clean up active selection visual highlights and borders
    clonedSvg.querySelectorAll("*").forEach(el => {
      // Revert selection stroke
      const stroke = el.getAttribute('stroke');
      if (stroke === 'var(--accent)') {
        const fill = el.getAttribute('fill');
        if (fill === 'var(--c-room)') {
          el.setAttribute('stroke', 'transparent');
          el.setAttribute('stroke-width', '0');
          el.setAttribute('stroke-dasharray', '');
        } else if (fill === 'var(--c-furniture)') {
          el.setAttribute('stroke', 'var(--c-furniture)');
          el.setAttribute('stroke-width', '1');
        } else if (fill === 'var(--c-window)') {
          el.setAttribute('stroke', 'var(--c-window)');
          el.setAttribute('stroke-width', '1.2');
        } else if (fill === 'var(--c-door)') {
          el.setAttribute('stroke', 'var(--c-door)');
          el.setAttribute('stroke-width', '1');
        } else if (fill === 'var(--ink-4)' || el.parentElement?.classList?.contains('slab')) {
          el.setAttribute('stroke', 'var(--border-strong)');
          el.setAttribute('stroke-width', '1');
        } else {
          el.setAttribute('stroke', 'var(--ink-2)');
          el.setAttribute('stroke-width', '1');
        }
      }

      // Revert selected room/furniture fill opacities
      const fill = el.getAttribute('fill');
      const fillOpacity = el.getAttribute('fill-opacity');
      if (fill === 'var(--c-room)' && fillOpacity === '0.32') {
        el.setAttribute('fill-opacity', '0.14');
      } else if (fill === 'var(--c-furniture)' && fillOpacity === '0.42') {
        el.setAttribute('fill-opacity', '0.22');
      }

      // Revert wall selection rect outlines
      if (el.tagName === 'rect' && el.getAttribute('stroke') === 'var(--accent)' && 
          (fill === 'var(--c-wall)' || fill === 'var(--ink-3)')) {
        el.setAttribute('stroke', 'transparent');
        el.setAttribute('stroke-width', '0');
      }
    });

    // Inline light theme variables inside the SVG styles block for self-containment
    clonedSvg.style.background = bgVal;
    clonedSvg.style.color = inkVal;
    
    const styleEl = document.createElement("style");
    styleEl.innerHTML = `
      svg {
        --bg: ${bgVal};
        --panel: ${panelVal};
        --panel-2: ${panel2Val};
        --border: ${borderVal};
        --border-strong: ${borderStrongVal};
        --border-faint: ${borderFaintVal};
        --ink: ${inkVal};
        --ink-2: ${ink2Val};
        --ink-3: ${ink3Val};
        --ink-4: ${ink4Val};
        --accent: ${accentVal};
        
        --c-room: ${cRoomVal};
        --c-wall: ${cWallVal};
        --c-door: ${cDoorVal};
        --c-window: ${cWindowVal};
        --c-furniture: ${cFurnitureVal};
        
        background: ${bgVal};
        color: ${inkVal};
        font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
      }
      
      text {
        fill: ${inkVal};
        font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
      }
      
      line, path, rect, circle, polygon {
        transition: none !important;
      }
    `;
    clonedSvg.appendChild(styleEl);
    
    // Serialize to XML
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clonedSvg);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Create high-DPI canvas
      const canvas = document.createElement('canvas');
      const dpiScale = 3.0; // 3x resolution super-sampling for beautiful PDF prints
      canvas.width = width * dpiScale;
      canvas.height = height * dpiScale;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpiScale, dpiScale);
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to high-quality JPEG to embed in PDF
        const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95);
        
        // Build the PDF blob
        const pdfBlob = buildSimpleImagePDF(jpegDataUrl, canvas.width, canvas.height);
        
        // Trigger download
        triggerFileDownload(pdfBlob, `${projectName.replace(/\s+/g, '_')}_floorplan.pdf`, 'application/pdf');
        
        URL.revokeObjectURL(url);
      }
    };
    img.src = url;
  } catch (err) {
    console.error("PDF render failed: ", err);
    alert("Impossible de générer le fichier PDF.");
  }
}

// ── PDF Binary stream builder helper ──────────────────────────────────────────
function buildSimpleImagePDF(jpegDataUrl: string, width: number, height: number): Blob {
  // Extract base64 binary from data URL
  const base64Str = jpegDataUrl.split(',')[1];
  const binaryString = atob(base64Str);
  const len = binaryString.length;
  const imageBytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    imageBytes[i] = binaryString.charCodeAt(i);
  }
  
  // PDF Page size: A4 Landscape is 842 x 595 points
  const pageW = 842;
  const pageH = 595;
  
  // Calculate aspect ratio fit inside A4 landscape with margins
  const margin = 20;
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;
  
  const scale = Math.min(availW / width, availH / height);
  const drawW = width * scale;
  const drawH = height * scale;
  const xOffset = margin + (availW - drawW) / 2;
  const yOffset = margin + (availH - drawH) / 2;
  
  // We will build the PDF objects manually as Uint8Arrays
  const encoder = new TextEncoder();
  
  const obj1 = `%PDF-1.3\r\n1 0 obj\r\n<< /Type /Catalog /Pages 2 0 R >>\r\nendobj\r\n`;
  const obj2 = `2 0 obj\r\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\r\nendobj\r\n`;
  const obj3 = `3 0 obj\r\n<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 4 0 R >> >> /MediaBox [0 0 ${pageW} ${pageH}] /Contents 5 0 R >>\r\nendobj\r\n`;
  
  const imgHeader = `4 0 obj\r\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\r\nstream\r\n`;
  const imgFooter = `\r\nendstream\r\nendobj\r\n`;
  
  // Page contents stream: draws the image fitted and centered
  const contentsStream = `q\r\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${xOffset.toFixed(2)} ${yOffset.toFixed(2)} cm\r\n/Im1 Do\r\nQ\r\n`;
  const obj5 = `5 0 obj\r\n<< /Length ${contentsStream.length} >>\r\nstream\r\n${contentsStream}endstream\r\nendobj\r\n`;
  
  const trailer = `xref\r\n0 6\r\n0000000000 65535 f \r\n\r\ntrailer\r\n<< /Size 6 /Root 1 0 R >>\r\n%%EOF\r\n`;
  
  // Join all byte arrays
  const chunks: Uint8Array[] = [
    encoder.encode(obj1),
    encoder.encode(obj2),
    encoder.encode(obj3),
    encoder.encode(imgHeader),
    imageBytes,
    encoder.encode(imgFooter),
    encoder.encode(obj5),
    encoder.encode(trailer)
  ];
  
  // Calculate total length
  let totalLength = 0;
  for (const chunk of chunks) totalLength += chunk.length;
  
  const pdfBytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    pdfBytes.set(chunk, offset);
    offset += chunk.length;
  }
  
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

// ── 5. Export as PNG Image (.png) ─────────────────────────────────────────────
export function exportToPNG(svgSelector: string, projectName: string) {
  const svgEl = document.querySelector(svgSelector) as SVGSVGElement | null;
  if (!svgEl) {
    alert("Canvas element not found for export.");
    return;
  }
  
  try {
    // Clone SVG node to prevent modifications to UI
    const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
    
    // Get view attributes
    const width = svgEl.clientWidth || 1200;
    const height = svgEl.clientHeight || 700;
    
    clonedSvg.setAttribute("width", String(width));
    clonedSvg.setAttribute("height", String(height));
    
    // Detect active page theme
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    
    // Theme colors mapping
    const bgVal = isDark ? "#0b0b0c" : "#ffffff";
    const panelVal = isDark ? "#131315" : "#fafaf9";
    const panel2Val = isDark ? "#19191c" : "#f4f4f2";
    const borderVal = isDark ? "#25252a" : "#e7e5e2";
    const borderStrongVal = isDark ? "#34343b" : "#d4d2cf";
    const borderFaintVal = isDark ? "#1c1c20" : "#efedea";
    
    const inkVal = isDark ? "#f3f3f4" : "#0c0c0d";
    const ink2Val = isDark ? "#b5b5bb" : "#4b4b50";
    const ink3Val = isDark ? "#7e7e85" : "#8a8a90";
    const ink4Val = isDark ? "#4f4f56" : "#b8b8be";
    
    const accentVal = isDark ? "oklch(0.72 0.13 230)" : "oklch(0.55 0.12 235)";
    
    const cRoomVal = isDark ? "oklch(0.7 0.07 145)" : "oklch(0.86 0.05 145)";
    const cWallVal = isDark ? "#a1a1a8" : "#525252";
    const cDoorVal = isDark ? "oklch(0.7 0.14 35)" : "oklch(0.66 0.13 35)";
    const cWindowVal = isDark ? "oklch(0.74 0.10 215)" : "oklch(0.72 0.08 215)";
    const cFurnitureVal = isDark ? "oklch(0.74 0.09 280)" : "oklch(0.7 0.07 280)";

    // Remove all editor-only overlays (grid lines, selection handles, coordinate displays, guides)
    clonedSvg.querySelectorAll(".editor-overlay").forEach(el => el.remove());

    // Clean up active selection visual highlights and borders
    clonedSvg.querySelectorAll("*").forEach(el => {
      // Revert selection stroke
      const stroke = el.getAttribute('stroke');
      if (stroke === 'var(--accent)') {
        const fill = el.getAttribute('fill');
        if (fill === 'var(--c-room)') {
          el.setAttribute('stroke', 'transparent');
          el.setAttribute('stroke-width', '0');
          el.setAttribute('stroke-dasharray', '');
        } else if (fill === 'var(--c-furniture)') {
          el.setAttribute('stroke', 'var(--c-furniture)');
          el.setAttribute('stroke-width', '1');
        } else if (fill === 'var(--c-window)') {
          el.setAttribute('stroke', 'var(--c-window)');
          el.setAttribute('stroke-width', '1.2');
        } else if (fill === 'var(--c-door)') {
          el.setAttribute('stroke', 'var(--c-door)');
          el.setAttribute('stroke-width', '1');
        } else if (fill === 'var(--ink-4)' || el.parentElement?.classList?.contains('slab')) {
          el.setAttribute('stroke', 'var(--border-strong)');
          el.setAttribute('stroke-width', '1');
        } else {
          el.setAttribute('stroke', 'var(--ink-2)');
          el.setAttribute('stroke-width', '1');
        }
      }

      // Revert selected room/furniture fill opacities
      const fill = el.getAttribute('fill');
      const fillOpacity = el.getAttribute('fill-opacity');
      if (fill === 'var(--c-room)' && fillOpacity === '0.32') {
        el.setAttribute('fill-opacity', '0.14');
      } else if (fill === 'var(--c-furniture)' && fillOpacity === '0.42') {
        el.setAttribute('fill-opacity', '0.22');
      }

      // Revert wall selection rect outlines
      if (el.tagName === 'rect' && el.getAttribute('stroke') === 'var(--accent)' && 
          (fill === 'var(--c-wall)' || fill === 'var(--ink-3)')) {
        el.setAttribute('stroke', 'transparent');
        el.setAttribute('stroke-width', '0');
      }
    });

    // Inline all active theme variables inside the SVG styles block for self-containment
    clonedSvg.style.background = bgVal;
    clonedSvg.style.color = inkVal;
    
    const styleEl = document.createElement("style");
    styleEl.innerHTML = `
      svg {
        --bg: ${bgVal};
        --panel: ${panelVal};
        --panel-2: ${panel2Val};
        --border: ${borderVal};
        --border-strong: ${borderStrongVal};
        --border-faint: ${borderFaintVal};
        --ink: ${inkVal};
        --ink-2: ${ink2Val};
        --ink-3: ${ink3Val};
        --ink-4: ${ink4Val};
        --accent: ${accentVal};
        
        --c-room: ${cRoomVal};
        --c-wall: ${cWallVal};
        --c-door: ${cDoorVal};
        --c-window: ${cWindowVal};
        --c-furniture: ${cFurnitureVal};
        
        background: ${bgVal};
        color: ${inkVal};
        font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
      }
      
      text {
        fill: ${inkVal};
        font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
      }
      
      line, path, rect, circle, polygon {
        transition: none !important;
      }
    `;
    clonedSvg.appendChild(styleEl);
    
    // Serialize to XML
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clonedSvg);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Create high-DPI canvas
      const canvas = document.createElement('canvas');
      const dpiScale = 2.0; // 2x resolution super-sampling
      canvas.width = width * dpiScale;
      canvas.height = height * dpiScale;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpiScale, dpiScale);
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob((blob) => {
          if (blob) {
            triggerFileDownload(blob, `${projectName.replace(/\s+/g, '_')}_floorplan.png`, 'image/png');
          }
          URL.revokeObjectURL(url);
        }, 'image/png');
      }
    };
    img.src = url;
  } catch (err) {
    console.error("PNG render failed: ", err);
    alert("Impossible de générer le fichier image.");
  }
}
