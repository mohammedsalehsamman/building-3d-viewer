// Space types: Arabic label, plan colour, behaviour.
//  kind: 'unit'   – sellable / rentable, clickable with full info card
//        'common' – shared enclosed rooms (core, services)
//        'open'   – circulation / open areas: no partition walls of their own
//  facade: style used where this space meets the exterior wall
export const TYPES = {
  studio:   { label: 'استوديو',          color: '#f2c76e', kind: 'unit',   facade: 'window' },
  shop:     { label: 'محل تجاري',        color: '#ef8a62', kind: 'unit',   facade: 'storefront' },
  office:   { label: 'مكتب',             color: '#7fb3d5', kind: 'unit',   facade: 'ribbon' },
  parking:  { label: 'موقف سيارة',       color: '#9aa5b1', kind: 'unit',   facade: 'solid' },
  cafe:     { label: 'صالة المقهى',      color: '#c39bd3', kind: 'unit',   facade: 'curtain' },
  terrace:  { label: 'تراس المقهى',      color: '#b9d7a8', kind: 'open',   facade: 'railing' },
  kitchen:  { label: 'مطبخ المقهى',      color: '#d7bde2', kind: 'common', facade: 'solid' },
  wc:       { label: 'حمامات',           color: '#aed6f1', kind: 'common', facade: 'small' },
  lobby:    { label: 'ردهة',             color: '#e5e7e9', kind: 'open',   facade: 'storefront' },
  corridor: { label: 'ممر',              color: '#eceff1', kind: 'open',   facade: 'small' },
  stair:    { label: 'درج',              color: '#bdbdbd', kind: 'common', facade: 'slot' },
  lift:     { label: 'مصعد',             color: '#a3a3a3', kind: 'common', facade: 'solid' },
  shaft:    { label: 'شفت خدمات',        color: '#8d8d8d', kind: 'common', facade: 'solid' },
  service:  { label: 'غرفة خدمات',       color: '#c8c8c8', kind: 'common', facade: 'small' },
  garbage:  { label: 'غرفة نفايات',      color: '#b5a48b', kind: 'common', facade: 'door' },
  drive:    { label: 'ممر سيارات',       color: '#6b7280', kind: 'open',   facade: 'solid' },
  ramp:     { label: 'رامب السيارات',    color: '#7c838d', kind: 'common', facade: 'opening' },
  generator:{ label: 'غرفة المولّد',      color: '#a1887f', kind: 'common', facade: 'solid' },
  electric: { label: 'غرفة الكهرباء',     color: '#bcaaa4', kind: 'common', facade: 'solid' },
  tank:     { label: 'خزان مياه',        color: '#90caf9', kind: 'common', facade: 'solid' },
  storage:  { label: 'مخازن',            color: '#cfc4b5', kind: 'common', facade: 'solid' },
  tech:     { label: 'منطقة تقنية',      color: '#b0bec5', kind: 'open',   facade: 'parapet' },
};

export const STATUS = {
  available: { label: 'متاح', color: '#2e9d5b' },
  reserved:  { label: 'محجوز', color: '#d99a1e' },
  sold:      { label: 'مباع', color: '#c0392b' },
};

export const typeOf = (t) => TYPES[t] || TYPES.service;
