import { DEFAULT_CATEGORIES, DEFAULT_RULES, DEFAULT_SETTINGS } from './finance.js';

const today = new Date();
const iso = daysAgo => {
  const d = new Date(today);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};

const categories = [
  ...DEFAULT_CATEGORIES,
  { id: 'salary_bonus', name: 'Bonus', group: 'Income', type: 'income', icon: '★', color: '#22C55E', isDefault: false },
  { id: 'hobby', name: 'Hobby', group: 'Lifestyle', type: 'expense', icon: '✦', color: '#A78BFA', isDefault: false }
];

const rules = [
  ...DEFAULT_RULES,
  { id: 'r_cinema', label: 'Cinema nights', categoryId: 'entertainment', keywords: ['cinema', 'cineplex', 'movie night'], caseSensitive: false },
  { id: 'r_hobby', label: 'Hobby stores', categoryId: 'hobby', keywords: ['thomann', 'lego', 'board game'], caseSensitive: false }
];

const accounts = [
  { id: 'acc_cash', name: 'Cash wallet', institution: 'Manual', type: 'cash', currency: 'EUR', openingBalance: 140, hidden: false, iban: '', accountNumber: '', bic: '', transferAliases: ['cash'], sort: 1 },
  { id: 'acc_checking', name: 'Main checking', institution: 'Sparkasse', type: 'checking', currency: 'EUR', openingBalance: 2640, hidden: false, iban: 'DE44123456781234567890', accountNumber: '1234567890', bic: 'BYLADEM1001', transferAliases: ['giro', 'main checking'], sort: 2 },
  { id: 'acc_savings', name: 'Travel savings', institution: 'Wise', type: 'savings', currency: 'EUR', openingBalance: 5380, hidden: false, iban: 'BE62510007547061', accountNumber: '507547061', bic: 'TRWIBEB1XXX', transferAliases: ['savings', 'wise'], sort: 3 },
  { id: 'acc_broker', name: 'Broker', institution: 'Trade Republic', type: 'broker', currency: 'EUR', openingBalance: 1800, hidden: false, iban: '', accountNumber: 'TR-001', bic: '', transferAliases: ['broker', 'trade republic'], sort: 4 },
  { id: 'acc_debt', name: 'Student debt', institution: 'Manual', type: 'debt', currency: 'EUR', openingBalance: -8600, hidden: false, iban: '', accountNumber: '', bic: '', transferAliases: ['debt'], sort: 5 },
  { id: 'acc_hidden', name: 'Old side card', institution: 'N26', type: 'checking', currency: 'EUR', openingBalance: 320, hidden: true, iban: 'DE12100100101212121212', accountNumber: 'N26-OLD', bic: 'NTSBDEB1XXX', transferAliases: ['old card'], sort: 6 }
];

const assets = [
  { id: 'ast_1', symbol: 'VWCE', name: 'FTSE All-World ETF', type: 'etf', quantity: 24.5, currency: 'EUR', costBasis: 2520, buyPrice: 102.85, wkn: 'A2PKXG', isin: 'IE00BK5BQT80', manualPrice: 118.4, provider: 'manual', accountId: 'acc_broker', hidden: false, createdAtMs: Date.now() - 5000000, lastPrice: 118.4, lastPriceAt: new Date().toISOString(), lastChangePercent: 0.84 },
  { id: 'ast_2', symbol: 'BTC', name: 'Bitcoin', type: 'crypto', quantity: 0.035, currency: 'EUR', costBasis: 1575, buyPrice: 45000, wkn: '', isin: '', manualPrice: 57500, provider: 'manual', accountId: 'acc_broker', hidden: false, createdAtMs: Date.now() - 4000000, lastPrice: 57500, lastPriceAt: new Date().toISOString(), lastChangePercent: -1.24 },
  { id: 'ast_3', symbol: 'SAP', name: 'SAP SE', type: 'stock', quantity: 8, currency: 'EUR', costBasis: 1240, buyPrice: 155, wkn: '716460', isin: 'DE0007164600', manualPrice: 189.2, provider: 'manual', accountId: 'acc_broker', hidden: false, createdAtMs: Date.now() - 3000000, lastPrice: 189.2, lastPriceAt: new Date().toISOString(), lastChangePercent: 0.56 }
];

const tx = [
  { id: 'tx1', accountId: 'acc_checking', date: iso(2), amount: 2850, currency: 'EUR', description: 'Monthly salary', counterparty: 'Acme GmbH', categoryId: 'income_salary', note: '', source: 'tutorial', review: false, confidence: 1, createdAtMs: Date.now() - 900000 },
  { id: 'tx2', accountId: 'acc_checking', date: iso(3), amount: -925, currency: 'EUR', description: 'Munich rent', counterparty: 'Hausverwaltung', categoryId: 'rent', note: '', source: 'tutorial', review: false, confidence: 1, createdAtMs: Date.now() - 890000 },
  { id: 'tx3', accountId: 'acc_checking', date: iso(4), amount: -78.2, currency: 'EUR', description: 'REWE weekly groceries', counterparty: 'REWE', categoryId: 'groceries', note: '', source: 'tutorial', review: false, confidence: 0.95, createdAtMs: Date.now() - 880000 },
  { id: 'tx4', accountId: 'acc_checking', date: iso(5), amount: -14.9, currency: 'EUR', description: 'Spotify', counterparty: 'Spotify', categoryId: 'subscriptions', note: '', source: 'tutorial', review: false, confidence: 0.94, createdAtMs: Date.now() - 870000 },
  { id: 'tx5', accountId: 'acc_checking', date: iso(6), amount: -42.3, currency: 'EUR', description: 'DB Bahn Deutschlandticket', counterparty: 'DB', categoryId: 'public_transport', note: '', source: 'tutorial', review: false, confidence: 0.91, createdAtMs: Date.now() - 860000 },
  { id: 'tx6', accountId: 'acc_checking', date: iso(7), amount: -31.4, currency: 'EUR', description: 'Mensa lunch group', counterparty: 'Studentenwerk', categoryId: 'restaurants', note: '', source: 'tutorial', review: false, confidence: 0.9, createdAtMs: Date.now() - 850000 },
  { id: 'tx7', accountId: 'acc_checking', date: iso(8), amount: -18.5, currency: 'EUR', description: 'Movie night', counterparty: 'Cineplex', categoryId: 'misc', note: 'Should be auto-categorized after adding rule', source: 'tutorial', review: true, confidence: 0.45, reason: 'Ambiguous merchant', candidates: [{ categoryId: 'entertainment', categoryName: 'Entertainment', score: 53 }, { categoryId: 'restaurants', categoryName: 'Restaurants', score: 41 }], createdAtMs: Date.now() - 840000 },
  { id: 'tx8', accountId: 'acc_checking', date: iso(10), amount: -65, currency: 'EUR', description: 'Urban Sports Club', counterparty: 'USC', categoryId: 'sport', note: '', source: 'tutorial', review: false, confidence: 0.89, createdAtMs: Date.now() - 830000 },
  { id: 'tx9', accountId: 'acc_checking', date: iso(12), amount: 120, currency: 'EUR', description: 'Refund Amazon', counterparty: 'Amazon', categoryId: 'refund', note: '', source: 'tutorial', review: false, confidence: 0.93, createdAtMs: Date.now() - 820000 },
  { id: 'tx10', accountId: 'acc_cash', date: iso(12), amount: -11.8, currency: 'EUR', description: 'Coffee & snack', counterparty: 'Campus Cafe', categoryId: 'restaurants', note: '', source: 'tutorial', review: false, confidence: 0.84, createdAtMs: Date.now() - 810000 },
  { id: 'tx11', accountId: 'acc_savings', date: iso(20), amount: 600, currency: 'EUR', description: 'Move to travel savings', counterparty: 'Main checking', categoryId: 'transfer', note: '', source: 'tutorial', review: false, confidence: 0.92, createdAtMs: Date.now() - 800000 },
  { id: 'tx12', accountId: 'acc_checking', date: iso(20), amount: -600, currency: 'EUR', description: 'Transfer to Wise savings', counterparty: 'Travel savings', categoryId: 'transfer', note: '', source: 'tutorial', review: false, confidence: 0.92, createdAtMs: Date.now() - 790000 },
  { id: 'tx13', accountId: 'acc_broker', date: iso(27), amount: -250, currency: 'EUR', description: 'ETF savings plan VWCE', counterparty: 'Trade Republic', categoryId: 'investment', note: '', source: 'tutorial', review: false, confidence: 0.95, createdAtMs: Date.now() - 780000 },
  { id: 'tx14', accountId: 'acc_broker', date: iso(28), amount: 18.4, currency: 'EUR', description: 'Dividend payout', counterparty: 'Vanguard', categoryId: 'income_dividend', note: '', source: 'tutorial', review: false, confidence: 0.95, createdAtMs: Date.now() - 770000 },
  { id: 'tx15', accountId: 'acc_checking', date: iso(35), amount: -52.2, currency: 'EUR', description: 'Electricity bill', counterparty: 'Stadtwerke', categoryId: 'utilities', note: '', source: 'tutorial', review: false, confidence: 0.91, createdAtMs: Date.now() - 760000 },
  { id: 'tx16', accountId: 'acc_checking', date: iso(43), amount: -44.4, currency: 'EUR', description: 'Pharmacy', counterparty: 'DocMorris', categoryId: 'health', note: '', source: 'tutorial', review: false, confidence: 0.88, createdAtMs: Date.now() - 750000 },
  { id: 'tx17', accountId: 'acc_checking', date: iso(58), amount: 420, currency: 'EUR', description: 'Freelance invoice payment', counterparty: 'Design Client', categoryId: 'income_freelance', note: '', source: 'tutorial', review: false, confidence: 0.94, createdAtMs: Date.now() - 740000 },
  { id: 'tx18', accountId: 'acc_checking', date: iso(64), amount: -89, currency: 'EUR', description: 'Uniqlo basics', counterparty: 'Uniqlo', categoryId: 'clothing', note: '', source: 'tutorial', review: false, confidence: 0.89, createdAtMs: Date.now() - 730000 },
  { id: 'tx19', accountId: 'acc_checking', date: iso(81), amount: -119, currency: 'EUR', description: 'Airbnb weekend trip', counterparty: 'Airbnb', categoryId: 'travel', note: '', source: 'tutorial', review: false, confidence: 0.92, createdAtMs: Date.now() - 720000 },
  { id: 'tx20', accountId: 'acc_checking', date: iso(95), amount: 260, currency: 'EUR', description: 'Tax refund', counterparty: 'Finanzamt', categoryId: 'refund', note: '', source: 'tutorial', review: false, confidence: 0.9, createdAtMs: Date.now() - 710000 }
];

export const TUTORIAL_DATA = {
  settings: {
    ...DEFAULT_SETTINGS,
    primaryCurrency: 'EUR',
    theme: 'dark',
    motion: 'on',
    compareMode: 'rolling',
    compareDays: 90,
    compareDate: '',
    marketProvider: 'manual',
    accountDeltaBars: true,
    hideTransfersFromSpending: true,
    quoteRefreshMinutes: 360,
    fxRates: { EUR: 1, USD: 1.09, KRW: 1472.4 },
    fxLastUpdatedAt: new Date().toISOString(),
    fxSource: 'tutorial'
  },
  categories,
  rules,
  accounts,
  assets,
  transactions: tx
};
