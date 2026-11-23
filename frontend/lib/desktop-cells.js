export const MIN_CELL_ROW = 0;
export const MAX_CELL_ROW = 49;
export const MIN_CELL_COLUMN = 0;
export const MAX_CELL_COLUMN = 47;

export const FIXED_CELL_KINDS = Object.freeze(new Set(['site', 'widget']));

export function isFixedCellCapableKind(kind) {
  return FIXED_CELL_KINDS.has(kind);
}

export function isValidPlacementCell(cell) {
  if (!cell || typeof cell !== 'object' || Array.isArray(cell)) return false;
  const { row, column } = cell;
  if (typeof row !== 'number' || typeof column !== 'number') return false;
  if (!Number.isInteger(row) || !Number.isInteger(column)) return false;
  return (
    row >= MIN_CELL_ROW &&
    row <= MAX_CELL_ROW &&
    column >= MIN_CELL_COLUMN &&
    column <= MAX_CELL_COLUMN
  );
}

export function normalizePlacementCell(rawCell, kind = 'site') {
  if (!isFixedCellCapableKind(kind)) return null;
  if (!isValidPlacementCell(rawCell)) return null;
  return {
    row: rawCell.row,
    column: rawCell.column,
  };
}

export function formatCellKey(cell) {
  return `${cell.row},${cell.column}`;
}

export function attachOptionalPlacementCell(target, rawCell, seenPageCells = null) {
  const normalized = normalizePlacementCell(rawCell, target.kind);
  if (!normalized) return target;
  if (seenPageCells) {
    const cellKey = formatCellKey(normalized);
    if (seenPageCells.has(cellKey)) {
      return target;
    }
    seenPageCells.add(cellKey);
  }
  return {
    ...target,
    cell: normalized,
  };
}
