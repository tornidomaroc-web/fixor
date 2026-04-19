import * as PDFDocument from "pdfkit";
import type { WorkflowResult } from "../types/workflow.types";

export async function generatePdfReport(
  workflow: WorkflowResult,
  metadata: {
    owner: string;
    repo: string;
    pullNumber: number;
    commitSha: string;
  }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const COLOR_ACCENT = "#f97316";
    const COLOR_DARK = "#1a1a1a";
    const COLOR_MUTED = "#6b7280";
    const COLOR_SUCCESS = "#16a34a";
    const COLOR_WARNING = "#f59e0b";
    const COLOR_DANGER = "#dc2626";
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // SECTION 1 — Cover Page (branded)
    // Orange accent bar at top
    doc.rect(0, 0, doc.page.width, 8).fill(COLOR_ACCENT);

    // Shield icon (simple representation using shapes)
    const centerX = doc.page.width / 2;
    doc.fillColor(COLOR_ACCENT)
       .moveTo(centerX, 120)
       .lineTo(centerX - 25, 132)
       .lineTo(centerX - 25, 160)
       .bezierCurveTo(centerX - 25, 178, centerX - 12, 195, centerX, 200)
       .bezierCurveTo(centerX + 12, 195, centerX + 25, 178, centerX + 25, 160)
       .lineTo(centerX + 25, 132)
       .closePath()
       .fill();

    // Checkmark in shield
    doc.strokeColor("#ffffff").lineWidth(2.5)
       .moveTo(centerX - 8, 160)
       .lineTo(centerX - 2, 168)
       .lineTo(centerX + 10, 152)
       .stroke();

    // Main title
    doc.moveDown(8);
    doc.font("Helvetica-Bold").fontSize(34).fillColor(COLOR_DARK).text("Fixor Security Report", { align: "center" });

    // Subtitle
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(13).fillColor(COLOR_MUTED).text("Automated vulnerability analysis", { align: "center" });

    doc.moveDown(2);

    // Separator line
    doc.strokeColor("#e5e7eb").lineWidth(1).moveTo(150, doc.y).lineTo(doc.page.width - 150, doc.y).stroke();
    doc.moveDown(1.5);

    // Metadata block (centered, clean)
    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const metaItems = [
      { label: "Repository", value: `${metadata.owner}/${metadata.repo}` },
      { label: "Pull Request", value: `#${metadata.pullNumber}` },
      { label: "Commit", value: metadata.commitSha.slice(0, 12) },
      { label: "Generated", value: dateStr },
    ];

    for (const item of metaItems) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(COLOR_MUTED).text(item.label.toUpperCase(), { align: "center", characterSpacing: 1 });
      doc.font("Helvetica").fontSize(13).fillColor(COLOR_DARK).text(item.value, { align: "center" });
      doc.moveDown(0.8);
    }

    doc.addPage();

    // SECTION 2 — Executive Summary (visual)
    doc.rect(0, 0, doc.page.width, 8).fill(COLOR_ACCENT);
    doc.moveDown(2);

    doc.font("Helvetica-Bold").fontSize(24).fillColor(COLOR_DARK).text("Executive Summary");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(11).fillColor(COLOR_MUTED).text("Quick overview of this analysis run");
    doc.moveDown(1.5);

    const statusColor = workflow.status === "success" ? COLOR_SUCCESS : COLOR_DANGER;
    const automationColor = workflow.automationReady ? COLOR_SUCCESS : COLOR_WARNING;

    const summaryRows = [
      { label: "Workflow status", value: workflow.status, color: statusColor },
      { label: "Total findings", value: String(workflow.totalFindings), color: COLOR_DARK },
      { label: "Vulnerabilities found", value: String(workflow.sqlInjectionFindings), color: workflow.sqlInjectionFindings > 0 ? COLOR_DANGER : COLOR_SUCCESS },
      { label: "Fixes generated", value: String(workflow.fixesGenerated), color: COLOR_DARK },
      { label: "High quality patches", value: String(workflow.highQualityPatches), color: COLOR_SUCCESS },
      { label: "Medium quality patches", value: String(workflow.mediumQualityPatches), color: COLOR_WARNING },
      { label: "Low quality patches", value: String(workflow.lowQualityPatches), color: workflow.lowQualityPatches > 0 ? COLOR_DANGER : COLOR_MUTED },
      { label: "Analysis duration", value: `${workflow.timing.durationMs} ms`, color: COLOR_DARK },
      { label: "Automation ready", value: workflow.automationReady ? "Yes" : "No", color: automationColor },
    ];

    for (const row of summaryRows) {
      const startY = doc.y;
      doc.rect(50, startY, doc.page.width - 100, 26).fillAndStroke("#fafafa", "#e5e7eb");
      doc.font("Helvetica").fontSize(11).fillColor(COLOR_MUTED).text(row.label, 65, startY + 8);
      doc.font("Helvetica-Bold").fontSize(11).fillColor(row.color).text(row.value, 65, startY + 8, { width: doc.page.width - 130, align: "right" });
      doc.moveDown(0.3);
    }

    if (workflow.fixes.length > 0) {
      doc.addPage();
    }

    // SECTION 3 — Detailed Findings (cards)
    for (let i = 0; i < workflow.fixes.length; i++) {
      const fix = workflow.fixes[i];

      // Top accent bar
      doc.rect(0, 0, doc.page.width, 8).fill(COLOR_ACCENT);

      // Finding badge
      doc.moveDown(2);
      const badgeY = doc.y;
      doc.rect(50, badgeY, 95, 22).fill(COLOR_ACCENT);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff").text(`FINDING ${i + 1}/${workflow.fixes.length}`, 50, badgeY + 7, { width: 95, align: "center" });
      doc.moveDown(2);

      // File location (large, prominent)
      doc.font("Helvetica-Bold").fontSize(18).fillColor(COLOR_DARK).text(`${fix.file}:${fix.line}`);
      doc.moveDown(0.5);

      // Meta tags row
      const tagY = doc.y;
      let tagX = 50;
      const tags = [
        { text: fix.type.toUpperCase(), bg: "#fef3c7", fg: "#92400e" },
        { text: fix.patchQuality.toUpperCase(), bg: "#dbeafe", fg: "#1e40af" },
        { text: fix.confidence.toUpperCase(), bg: "#e0e7ff", fg: "#3730a3" },
      ];
      for (const tag of tags) {
        const width = doc.widthOfString(tag.text) + 16;
        doc.rect(tagX, tagY, width, 18).fill(tag.bg);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(tag.fg).text(tag.text, tagX + 8, tagY + 5);
        tagX += width + 8;
      }
      doc.moveDown(2);

      // Explanation section
      doc.font("Helvetica-Bold").fontSize(12).fillColor(COLOR_DARK).text("Explanation");
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(11).fillColor("#374151").text(fix.explanation, { align: "justify" });
      doc.moveDown(1);

      const truncateStr = (str: string, max: number) => str.length > max ? str.substring(0, max - 3) + "..." : str;

      // Original code (red-tinted)
      doc.font("Helvetica-Bold").fontSize(12).fillColor(COLOR_DANGER).text("✗ Original (vulnerable)");
      doc.moveDown(0.3);
      const origY = doc.y;
      const origText = truncateStr(fix.originalCode, 500);
      const origHeight = doc.heightOfString(origText, { width: doc.page.width - 130 }) + 20;
      doc.rect(50, origY, doc.page.width - 100, origHeight).fillAndStroke("#fef2f2", "#fecaca");
      doc.font("Courier").fontSize(9).fillColor(COLOR_DARK).text(origText, 65, origY + 10, { width: doc.page.width - 130 });
      doc.moveDown(1.5);

      // Suggested fix (green-tinted)
      doc.font("Helvetica-Bold").fontSize(12).fillColor(COLOR_SUCCESS).text("✓ Suggested fix");
      doc.moveDown(0.3);
      const fixY = doc.y;
      const fixText = truncateStr(fix.fixedCode, 500);
      const fixHeight = doc.heightOfString(fixText, { width: doc.page.width - 130 }) + 20;
      doc.rect(50, fixY, doc.page.width - 100, fixHeight).fillAndStroke("#f0fdf4", "#bbf7d0");
      doc.font("Courier").fontSize(9).fillColor(COLOR_DARK).text(fixText, 65, fixY + 10, { width: doc.page.width - 130 });

      if (i < workflow.fixes.length - 1) {
        doc.addPage();
      }
    }

    // Apply global footer
    const range = doc.bufferedPageRange();
    const totalPages = range.count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(range.start + i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(9).fillColor("gray");
      doc.text(
        `Generated by Fixor · fixor-production.up.railway.app          Page ${i + 1} of ${totalPages}`,
        50,
        doc.page.height - 35,
        { align: "center", width: doc.page.width - 100, lineBreak: false }
      );
      doc.page.margins.bottom = bottom;
    }

    doc.end();
  });
}
