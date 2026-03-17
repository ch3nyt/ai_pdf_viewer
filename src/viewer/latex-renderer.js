function escapeHtml(input) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const LATEX_SYMBOL_MAP = Object.freeze({
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\delta": "δ",
  "\\epsilon": "ϵ",
  "\\varepsilon": "ε",
  "\\theta": "θ",
  "\\lambda": "λ",
  "\\mu": "μ",
  "\\pi": "π",
  "\\sigma": "σ",
  "\\tau": "τ",
  "\\phi": "ϕ",
  "\\varphi": "φ",
  "\\omega": "ω",
  "\\Gamma": "Γ",
  "\\Delta": "Δ",
  "\\Theta": "Θ",
  "\\Lambda": "Λ",
  "\\Pi": "Π",
  "\\Sigma": "Σ",
  "\\Phi": "Φ",
  "\\Omega": "Ω",
  "\\times": "×",
  "\\cdot": "·",
  "\\pm": "±",
  "\\leq": "≤",
  "\\geq": "≥",
  "\\neq": "≠",
  "\\to": "→",
  "\\Rightarrow": "⇒",
  "\\infty": "∞"
});

function renderLatexFallback(latex) {
  let text = String(latex || "");
  for (const [cmd, symbol] of Object.entries(LATEX_SYMBOL_MAP)) {
    text = text.replaceAll(cmd, symbol);
  }
  return `<code class="latex-fallback">${escapeHtml(text)}</code>`;
}

function renderMath(latex, displayMode) {
  if (window.katex && typeof window.katex.renderToString === "function") {
    try {
      return window.katex.renderToString(latex, {
        throwOnError: false,
        displayMode
      });
    } catch (_error) {
      return renderLatexFallback(latex);
    }
  }
  return renderLatexFallback(latex);
}

export function renderRichText(input) {
  const text = String(input || "");
  const blockParts = text.split(/(\$\$[\s\S]*?\$\$)/g);
  const html = blockParts
    .map((part) => {
      if (part.startsWith("$$") && part.endsWith("$$")) {
        const latex = part.slice(2, -2).trim();
        return `<div class="math-block">${renderMath(latex, true)}</div>`;
      }
      const inlineParts = part.split(/(\$[^$\n]+\$)/g);
      return inlineParts
        .map((inlinePart) => {
          if (inlinePart.startsWith("$") && inlinePart.endsWith("$")) {
            const latex = inlinePart.slice(1, -1).trim();
            return `<span class="math-inline">${renderMath(latex, false)}</span>`;
          }
          return escapeHtml(inlinePart).replaceAll("\n", "<br />");
        })
        .join("");
    })
    .join("");
  return html;
}
