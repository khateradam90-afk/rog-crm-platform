import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Search, Phone, Users, TrendingUp, FileText, Settings } from 'lucide-react';
import toast from 'react-hot-toast';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// ============= GLOBAL SEARCH COMPONENT =============
const GlobalSearch = ({ onResults }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchType, setSearchType] = useState('all'); // all, leads, agents, policies

  const performSearch = async () => {
    if (!query.trim()) return;
    
    setLoading(true);
    try {
      const endpoints = [];
      
      if (searchType === 'all' || searchType === 'leads') {
        endpoints.push(
          axios.get(`${API_BASE_URL}/api/leads`).then(res => ({
            type: 'leads',
            data: res.data.filter(l => 
              l.name.toLowerCase().includes(query.toLowerCase()) ||
              (l.email || '').toLowerCase().includes(query.toLowerCase()) ||
              (l.phone || '').includes(query)
            )
          }))
        );
      }
      
      if (searchType === 'all' || searchType === 'agents') {
        endpoints.push(
          axios.get(`${API_BASE_URL}/api/agents`).then(res => ({
            type: 'agents',
            data: res.data.filter(a => 
              a.name.toLowerCase().includes(query.toLowerCase()) ||
              (a.email || '').toLowerCase().includes(query.toLowerCase()) ||
              (a.phone || '').includes(query)
            )
          }))
        );
      }
      
      if (searchType === 'all' || searchType === 'policies') {
        endpoints.push(
          axios.get(`${API_BASE_URL}/api/policies`).then(res => ({
            type: 'policies',
            data: res.data.filter(p => 
              p.policy_number.toLowerCase().includes(query.toLowerCase()) ||
              p.client_name.toLowerCase().includes(query.toLowerCase())
            )
          }))
        );
      }
      
      const responses = await Promise.all(endpoints);
      setResults(responses);
      onResults(responses);
    } catch (error) {
      toast.error('Search failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg border-2 border-gold-200">
      <div className="flex gap-4 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 text-gold-600" size={20} />
          <input
            type="text"
            placeholder="Search leads, agents, policies, phone numbers..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && performSearch()}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold-500"
          />
        </div>
        <button
          onClick={performSearch}
          disabled={loading}
          className="px-6 py-2 bg-gradient-to-r from-gold-500 to-gold-600 text-white rounded-lg hover:shadow-lg transition disabled:opacity-50"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>
      
      <div className="flex gap-2 flex-wrap">
        {['all', 'leads', 'agents', 'policies'].map(type => (
          <button
            key={type}
            onClick={() => setSearchType(type)}
            className={`px-4 py-1 rounded-full text-sm transition ${
              searchType === type
                ? 'bg-gold-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>
      
      {results && (
        <div className="mt-6 space-y-4">
          {results.map(result => (
            <div key={result.type} className="border-t pt-4">
              <h3 className="font-bold text-gold-700 mb-2 capitalize">{result.type}</h3>
              {result.data.length > 0 ? (
                <ul className="space-y-1">
                  {result.data.slice(0, 5).map(item => (
                    <li key={item.id} className="text-sm p-2 bg-gray-50 rounded hover:bg-gold-50 cursor-pointer">
                      {result.type === 'leads' && `${item.name} (${item.phone || item.email || 'N/A'})`}
                      {result.type === 'agents' && `${item.name} - ${item.email}`}
                      {result.type === 'policies' && `${item.policy_number} - ${item.client_name}`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No {result.type} found</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============= LIFE INSURANCE QUOTER =============
const LifeInsuranceQuoter = () => {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    age: 35,
    gender: 'M',
    health: 'excellent', // excellent, good, fair, poor
    smoker: false,
    coverageAmount: 500000, // $500k default
    term: 20, // 10, 20, 30 year term
    productType: 'term', // term, whole, iul
  });
  const [quote, setQuote] = useState(null);
  const [carriers, setCarriers] = useState([]);

  useEffect(() => {
    fetchCarriers();
  }, []);

  const fetchCarriers = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/carriers`);
      setCarriers(res.data);
    } catch (error) {
      console.error('Failed to load carriers:', error);
    }
  };

  const calculateQuote = () => {
    // Base rate calculation (simplified actuarial model)
    let baseRate = 0.05; // Base premium as % of face amount per year

    // Age factor
    const ageFactors = {
      '20-30': 0.5,
      '31-40': 0.8,
      '41-50': 1.2,
      '51-60': 2.0,
      '61-70': 4.0,
    };
    const ageBracket = formData.age < 30 ? '20-30' : formData.age < 40 ? '31-40' : formData.age < 50 ? '41-50' : formData.age < 60 ? '51-60' : '61-70';
    baseRate *= ageFactors[ageBracket];

    // Health factor
    const healthFactors = {
      excellent: 0.7,
      good: 1.0,
      fair: 1.5,
      poor: 2.5,
    };
    baseRate *= healthFactors[formData.health];

    // Smoker factor (3-4x more expensive)
    if (formData.smoker) baseRate *= 3.5;

    // Product type factor
    const productFactors = {
      term: 1.0,
      whole: 3.5,
      iul: 2.8,
    };
    baseRate *= productFactors[formData.productType];

    // Term length factor
    const termFactors = {
      10: 1.0,
      20: 1.3,
      30: 1.6,
    };
    baseRate *= termFactors[formData.term];

    const monthlyPremium = (formData.coverageAmount * baseRate) / 12;
    const annualPremium = monthlyPremium * 12;

    // Get matching products
    const matchedProducts = carriers
      .filter(c => c.product_type === formData.productType)
      .slice(0, 3);

    setQuote({
      monthlyPremium: monthlyPremium.toFixed(2),
      annualPremium: annualPremium.toFixed(2),
      estimatedDeathBenefit: formData.coverageAmount,
      policyTerm: `${formData.term} years`,
      products: matchedProducts,
      underwritingTime: formData.health === 'excellent' ? '3-5 business days' : '5-10 business days',
    });
  };

  return (
    <div className="bg-gradient-to-br from-gold-50 to-white p-8 rounded-lg shadow-xl border-2 border-gold-200">
      <h2 className="text-3xl font-bold text-gold-800 mb-6">💰 Life Insurance Quoter</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {/* Personal Info */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">First Name</label>
          <input
            type="text"
            value={formData.firstName}
            onChange={(e) => setFormData({...formData, firstName: e.target.value})}
            className="w-full px-3 py-2 border border-gold-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold-500"
          />
        </div>
        
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Last Name</label>
          <input
            type="text"
            value={formData.lastName}
            onChange={(e) => setFormData({...formData, lastName: e.target.value})}
            className="w-full px-3 py-2 border border-gold-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold-500"
          />
        </div>
        
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Age</label>
          <input
            type="number"
            value={formData.age}
            onChange={(e) => setFormData({...formData, age: parseInt(e.target.value)})}
            min="18"
            max="85"
            className="w-full px-3 py-2 border border-gold-300 rounded-lg"
          />
        </div>
        
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Gender</label>
          <select
            value={formData.gender}
            onChange={(e) => setFormData({...formData, gender: e.target.value})}
            className="w-full px-3 py-2 border border-gold-300 rounded-lg"
          >
            <option value="M">Male</option>
            <option value="F">Female</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Health Status</label>
          <select
            value={formData.health}
            onChange={(e) => setFormData({...formData, health: e.target.value})}
            className="w-full px-3 py-2 border border-gold-300 rounded-lg"
          >
            <option value="excellent">Excellent</option>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="poor">Poor</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Smoker?</label>
          <input
            type="checkbox"
            checked={formData.smoker}
            onChange={(e) => setFormData({...formData, smoker: e.target.checked})}
            className="w-5 h-5 text-gold-600 rounded"
          />
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Coverage Amount</label>
          <div className="flex items-center gap-2">
            <span className="text-gold-600">$</span>
            <input
              type="number"
              value={formData.coverageAmount}
              onChange={(e) => setFormData({...formData, coverageAmount: parseInt(e.target.value)})}
              step="50000"
              className="flex-1 px-3 py-2 border border-gold-300 rounded-lg"
            />
          </div>
        </div>
        
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Product Type</label>
          <select
            value={formData.productType}
            onChange={(e) => setFormData({...formData, productType: e.target.value})}
            className="w-full px-3 py-2 border border-gold-300 rounded-lg"
          >
            <option value="term">Term Life</option>
            <option value="whole">Whole Life</option>
            <option value="iul">Indexed Universal Life</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Term Length</label>
          <select
            value={formData.term}
            onChange={(e) => setFormData({...formData, term: parseInt(e.target.value)})}
            className="w-full px-3 py-2 border border-gold-300 rounded-lg"
          >
            <option value="10">10 Years</option>
            <option value="20">20 Years</option>
            <option value="30">30 Years</option>
          </select>
        </div>
        
        <div className="flex items-end">
          <button
            onClick={calculateQuote}
            className="w-full px-4 py-2 bg-gradient-to-r from-gold-500 to-gold-600 text-white font-semibold rounded-lg hover:shadow-lg transition"
          >
            Get Quote 🏆
          </button>
        </div>
      </div>
      
      {quote && (
        <div className="bg-white border-2 border-gold-300 rounded-lg p-6 mt-6">
          <h3 className="text-2xl font-bold text-gold-800 mb-4">📊 Your Quote</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gold-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Monthly Premium</p>
              <p className="text-4xl font-bold text-gold-700">${quote.monthlyPremium}</p>
            </div>
            <div className="bg-gold-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Annual Premium</p>
              <p className="text-4xl font-bold text-gold-700">${quote.annualPremium}</p>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Death Benefit</p>
              <p className="text-3xl font-bold text-blue-700">${quote.estimatedDeathBenefit.toLocaleString()}</p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Policy Term</p>
              <p className="text-3xl font-bold text-green-700">{quote.policyTerm}</p>
            </div>
          </div>
          
          <div className="mt-6">
            <p className="text-sm text-gray-600 mb-2">Underwriting Time: {quote.underwritingTime}</p>
            
            {quote.products.length > 0 && (
              <div className="mt-4">
                <h4 className="font-semibold text-gray-800 mb-2">Matching Products:</h4>
                <div className="space-y-2">
                  {quote.products.map(product => (
                    <div key={product.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <div>
                        <p className="font-semibold text-gray-800">{product.carrier}</p>
                        <p className="text-sm text-gray-600">{product.product}</p>
                      </div>
                      <p className="text-gold-600 font-bold">{(product.commission_pct || 0).toFixed(0)}% commission</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ============= AUTO-DIALER DASHBOARD =============
const AutoDialerDashboard = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCampaigns();
    fetchStats();
  }, []);

  const fetchCampaigns = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/dialer/campaigns`);
      setCampaigns(res.data);
    } catch (error) {
      toast.error('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/dialer/agent-stats/me`);
      setStats(res.data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const startCampaign = async (campaignId) => {
    try {
      await axios.post(`${API_BASE_URL}/api/dialer/campaigns/${campaignId}/start`);
      toast.success('Campaign started!');
      fetchCampaigns();
    } catch (error) {
      toast.error('Failed to start campaign');
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg border-2 border-gold-200">
      <div className="flex items-center gap-3 mb-6">
        <Phone className="text-gold-600" size={32} />
        <h2 className="text-3xl font-bold text-gold-800">Auto-Dialer</h2>
      </div>
      
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gold-50 p-4 rounded-lg text-center">
            <p className="text-sm text-gray-600">Calls Today</p>
            <p className="text-3xl font-bold text-gold-700">{stats.calls_today}</p>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg text-center">
            <p className="text-sm text-gray-600">Connections</p>
            <p className="text-3xl font-bold text-blue-700">{stats.connections_today}</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg text-center">
            <p className="text-sm text-gray-600">Contact Rate</p>
            <p className="text-3xl font-bold text-green-700">{stats.contact_rate}%</p>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg text-center">
            <p className="text-sm text-gray-600">Avg Duration</p>
            <p className="text-3xl font-bold text-purple-700">{stats.avg_call_duration}s</p>
          </div>
        </div>
      )}
      
      <div className="space-y-4">
        <h3 className="font-bold text-lg text-gray-800">Active Campaigns</h3>
        {loading ? (
          <p className="text-gray-600">Loading campaigns...</p>
        ) : campaigns.length > 0 ? (
          campaigns.map(campaign => (
            <div key={campaign.id} className="border-l-4 border-gold-500 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-gray-800">{campaign.name}</h4>
                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  campaign.status === 'active' ? 'bg-green-200 text-green-800' :
                  campaign.status === 'paused' ? 'bg-yellow-200 text-yellow-800' :
                  'bg-gray-200 text-gray-800'
                }`}>
                  {campaign.status.toUpperCase()}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-3">{campaign.description}</p>
              <div className="flex gap-2 text-sm">
                <span className="bg-white px-2 py-1 rounded">📞 {campaign.stats.calls_completed} calls</span>
                <span className="bg-white px-2 py-1 rounded">✅ {campaign.stats.contacts_made} contacts</span>
                <span className="bg-white px-2 py-1 rounded">🎯 {campaign.stats.total_leads} leads</span>
              </div>
              {campaign.status === 'draft' && (
                <button
                  onClick={() => startCampaign(campaign.id)}
                  className="mt-3 px-4 py-2 bg-gold-500 text-white rounded-lg hover:bg-gold-600 transition"
                >
                  Start Campaign
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="text-gray-600">No campaigns available</p>
        )}
      </div>
    </div>
  );
};

// ============= MAIN APP =============
function App() {
  const [activeTab, setActiveTab] = useState('search');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gold-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-gold-600 to-gold-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-4xl font-bold">🏆 R.O.G Financial CRM</h1>
          <p className="text-gold-100">Enterprise Life Insurance Platform</p>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b-2 border-gold-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-4 overflow-x-auto">
            {[
              { id: 'search', label: '🔍 Search', icon: Search },
              { id: 'quoter', label: '💰 Quoter', icon: FileText },
              { id: 'dialer', label: '📞 Dialer', icon: Phone },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-6 py-4 font-semibold transition border-b-4 ${
                  activeTab === tab.id
                    ? 'border-gold-600 text-gold-600'
                    : 'border-transparent text-gray-600 hover:text-gold-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'search' && <GlobalSearch onResults={() => {}} />}
        {activeTab === 'quoter' && <LifeInsuranceQuoter />}
        {activeTab === 'dialer' && <AutoDialerDashboard />}
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-8 text-center">
          <p>© 2024 R.O.G Financial. All Rights Reserved.</p>
          <p className="text-sm mt-2">Built with ❤️ for Insurance Professionals</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
