// --------------------------------------------------------------------------
// Configuration & Constants
// --------------------------------------------------------------------------
const REFRESH_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes auto-refresh

// Determine the news fetch URL based on environment (local python proxy vs allorigins for GitHub Pages)
function getNewsUrl(query) {
    const hostname = window.location.hostname;
    // Check if it's localhost, 127.0.0.1, or a local IP (192.168.x.x, 10.x.x.x, 172.16.x.x-172.31.x.x)
    const isLocal = hostname === "localhost" || 
                    hostname === "127.0.0.1" || 
                    hostname.startsWith("192.168.") || 
                    hostname.startsWith("10.") ||
                    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
                    
    if (isLocal) {
        return `/api/news?q=${encodeURIComponent(query)}&t=${Date.now()}`;
    } else {
        const googleNewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
        // Use rss2json API for robust production feed conversion
        return `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(googleNewsUrl)}`;
    }
}

// Helper to parse single stock input into name, keyword, and symbol
function parseStockInput(rawInput) {
    const input = rawInput.trim();
    if (!input) return null;
    
    let name = input;
    let keyword = input;
    let symbol = null;
    
    // 1. Check for full TradingView symbol format (e.g. NYSE:SONY, TSE:7203, NASDAQ:AAPL)
    const tvMatch = input.match(/\b([A-Z]{2,6}:[A-Z0-9]{1,6})\b/i);
    // 2. Check for isolated Japanese stock code (4 digits)
    const jpCodeMatch = input.match(/\b(\d{4})\b/);
    // 3. Check for isolated US ticker (1 to 5 letters, like AAPL, SONY, TSLA, NVDA)
    const usTickerMatch = input.match(/\b([A-Z]{1,5})\b/i);
    
    if (tvMatch) {
        symbol = tvMatch[0].toUpperCase();
        const cleanName = input.replace(new RegExp(tvMatch[0], 'i'), "").replace(/\s+/g, " ").trim();
        if (cleanName) {
            name = cleanName;
            keyword = cleanName;
        } else {
            name = symbol.split(":")[1];
            keyword = name;
        }
    } else if (jpCodeMatch) {
        const code = jpCodeMatch[0];
        symbol = `TSE:${code}`;
        const cleanName = input.replace(code, "").replace(/\s+/g, " ").trim();
        if (cleanName) {
            name = cleanName;
            keyword = cleanName;
        } else {
            name = `コード ${code}`;
            keyword = code;
        }
    } else if (usTickerMatch) {
        const ticker = usTickerMatch[0].toUpperCase();
        const exchange = ticker.length === 4 ? "NASDAQ" : "NYSE";
        symbol = `${exchange}:${ticker}`;
        const cleanName = input.replace(new RegExp(usTickerMatch[0], 'i'), "").replace(/\s+/g, " ").trim();
        if (cleanName) {
            name = cleanName;
            keyword = cleanName;
        } else {
            name = ticker;
            keyword = ticker;
        }
    }
    
    return { name, keyword, symbol };
}

// Sentiment and importance keywords
const POSITIVE_KEYWORDS = [
    "上方修正", "増益", "最高益", "黒字化", "黒字", "業務提携", "提携", 
    "買収", "M&A", "増配", "自社株買い", "急騰", "好調", "堅調", 
    "受注拡大", "新開発", "新製品", "世界初", "好調", "成長", "拡大"
];

const NEGATIVE_KEYWORDS = [
    "下方修正", "減益", "赤字", "損失", "不祥事", "急落", "下落", 
    "懸念", "減配", "制裁", "提訴", "回収", "リコール", "下回る", 
    "低迷", "衰退", "縮小", "赤字転落", "特損"
];

const IMPORTANT_KEYWORDS = [
    "決算", "発表", "公表", "会見", "TOB", "株式公開買付", 
    "ストップ高", "ストップ安", "適時開示", "人事", "合併", "売却"
];

// Default Stocks for first-time users
const DEFAULT_STOCKS = [
    { id: "1", name: "トヨタ自動車", keyword: "トヨタ", symbol: "TSE:7203" },
    { id: "2", name: "ソニーグループ", keyword: "ソニー", symbol: "TSE:6758" },
    { id: "3", name: "Apple", keyword: "Apple", symbol: "NASDAQ:AAPL" }
];

// --------------------------------------------------------------------------
// App State Management
// --------------------------------------------------------------------------
let state = {
    stocks: [],
    activeStockId: null,
    readArticles: new Set(),
    bookmarkedArticles: [],
    showOnlyImportant: false,
    showBookmarks: false,
    autoRefreshTimer: null
};

// --------------------------------------------------------------------------
// Lifecycle and Event Hooks
// --------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    loadStateFromStorage();
    initUI();
    setupEventHandlers();
    
    // Select first stock or show empty state
    if (state.stocks.length > 0) {
        selectStock(state.stocks[0].id);
    } else {
        renderStockList();
        renderNews();
    }
    
    // Start auto-refresh polling
    startAutoRefresh();
});

// Load state from LocalStorage
function loadStateFromStorage() {
    // Stocks
    const storedStocks = localStorage.getItem("sr_stocks");
    if (storedStocks) {
        state.stocks = JSON.parse(storedStocks);
    } else {
        state.stocks = [...DEFAULT_STOCKS];
        saveStocksToStorage();
    }

    // Active Stock ID
    const storedActiveId = localStorage.getItem("sr_active_stock_id");
    if (storedActiveId && state.stocks.some(s => s.id === storedActiveId)) {
        state.activeStockId = storedActiveId;
    } else if (state.stocks.length > 0) {
        state.activeStockId = state.stocks[0].id;
    }

    // Read Articles
    const storedRead = localStorage.getItem("sr_read_articles");
    if (storedRead) {
        state.readArticles = new Set(JSON.parse(storedRead));
    }

    // Bookmarks
    const storedBookmarks = localStorage.getItem("sr_bookmarks");
    if (storedBookmarks) {
        state.bookmarkedArticles = JSON.parse(storedBookmarks);
    }

    // Filters & Settings
    state.showOnlyImportant = localStorage.getItem("sr_show_important") === "true";
    
    // Set UI elements initial states
    document.getElementById("importantToggle").checked = state.showOnlyImportant;
}

function saveStocksToStorage() {
    localStorage.setItem("sr_stocks", JSON.stringify(state.stocks));
}

function saveBookmarksToStorage() {
    localStorage.setItem("sr_bookmarks", JSON.stringify(state.bookmarkedArticles));
}

function saveReadArticlesToStorage() {
    localStorage.setItem("sr_read_articles", JSON.stringify(Array.from(state.readArticles)));
}

// --------------------------------------------------------------------------
// UI Initialization & Event Handlers
// --------------------------------------------------------------------------
function initUI() {
    // Check if Service Worker is supported for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker Registered!', reg))
            .catch(err => console.error('Service Worker Registration Failed:', err));
    }
}

function setupEventHandlers() {
    // Sidebar toggle (Mobile)
    const sidebar = document.getElementById("sidebar");
    const menuToggleBtn = document.getElementById("menuToggleBtn");
    const closeSidebarBtn = document.getElementById("closeSidebarBtn");
    
    menuToggleBtn.addEventListener("click", () => {
        sidebar.classList.add("active");
    });
    
    closeSidebarBtn.addEventListener("click", () => {
        sidebar.classList.remove("active");
    });

    // Add Stock Modal control
    const addModal = document.getElementById("addModal");
    const openAddModalBtn = document.getElementById("openAddModalBtn");
    const emptyStateAddBtn = document.getElementById("emptyStateAddBtn");
    const closeModalBtn = document.getElementById("closeModalBtn");
    const cancelAddBtn = document.getElementById("cancelAddBtn");
    
    const showModal = () => addModal.classList.add("active");
    const hideModal = () => {
        document.activeElement?.blur?.();
        addModal.classList.remove("active");
        document.getElementById("addStockForm").reset();
        resetViewportScroll();
        
        // Also run after keyboard closing transition completes (approx 300ms)
        setTimeout(resetViewportScroll, 300);
        setTimeout(resetViewportScroll, 600);
    };
    
    openAddModalBtn.addEventListener("click", showModal);
    if (emptyStateAddBtn) {
        emptyStateAddBtn.addEventListener("click", showModal);
    }
    closeModalBtn.addEventListener("click", hideModal);
    cancelAddBtn.addEventListener("click", hideModal);
    
    // Add Stock Form Submit
    const addStockForm = document.getElementById("addStockForm");
    addStockForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const rawInput = document.getElementById("stockInputSingle").value.trim();
        
        const parsed = parseStockInput(rawInput);
        if (parsed) {
            const newStock = {
                id: Date.now().toString(),
                name: parsed.name,
                keyword: parsed.keyword,
                symbol: parsed.symbol
            };
            
            state.stocks.push(newStock);
            saveStocksToStorage();
            renderStockList();
            hideModal();
            setTimeout(() => {
                selectStock(newStock.id);
                resetViewportScroll();
                showToast(`「${parsed.name}」を登録しました`);
            }, 350);
        } else {
            showToast("入力内容を解析できませんでした", "error");
        }
    });

    // Refresh Button Click
    const refreshBtn = document.getElementById("refreshBtn");
    refreshBtn.addEventListener("click", () => {
        fetchNewsForActiveStock(true);
    });

    // Filter Toggle
    const importantToggle = document.getElementById("importantToggle");
    importantToggle.addEventListener("change", (e) => {
        state.showOnlyImportant = e.target.checked;
        localStorage.setItem("sr_show_important", state.showOnlyImportant);
        renderNews();
    });

    // Bookmarks View Toggle
    const bookmarkViewBtn = document.getElementById("bookmarkViewBtn");
    bookmarkViewBtn.addEventListener("click", () => {
        state.showBookmarks = !state.showBookmarks;
        
        if (state.showBookmarks) {
            bookmarkViewBtn.classList.add("active");
            document.getElementById("activeStockName").textContent = "ブックマーク";
            document.getElementById("activeStockSymbol").textContent = "お気に入り保存されたニュース";
            document.getElementById("chartSection").style.display = "none";
        } else {
            bookmarkViewBtn.classList.remove("active");
            if (state.activeStockId) {
                selectStock(state.activeStockId);
            } else {
                resetActiveStockUI();
            }
        }
        renderNews();
    });
}

// --------------------------------------------------------------------------
// Navigation & Stock Selection
// --------------------------------------------------------------------------
function selectStock(stockId) {
    state.showBookmarks = false;
    document.getElementById("bookmarkViewBtn").classList.remove("active");
    
    state.activeStockId = stockId;
    localStorage.setItem("sr_active_stock_id", stockId);
    
    const stock = state.stocks.find(s => s.id === stockId);
    if (!stock) return;
    
    // Update Header
    document.getElementById("activeStockName").textContent = stock.name;
    document.getElementById("activeStockSymbol").textContent = stock.symbol || "チャート連携なし";
    
    // Render List Active State
    renderStockList();
    
    // Handle TradingView Chart Widget
    const chartSection = document.getElementById("chartSection");
    const chartContainer = document.getElementById("tradingview_chart");
    
    if (stock.symbol) {
        chartSection.style.display = "block";
        chartContainer.innerHTML = ""; // Clear placeholder
        
        // Update external link
        const linkContainer = document.getElementById("chartLinkContainer");
        const externalLink = document.getElementById("externalChartLink");
        if (linkContainer && externalLink) {
            const formattedSymbol = stock.symbol.replace(":", "-"); // e.g., TSE-7203 or NASDAQ-AAPL
            externalLink.href = `https://jp.tradingview.com/symbols/${formattedSymbol}/`;
            linkContainer.style.display = "flex";
        }
        
        // Dynamically load TradingView Widget
        try {
            new TradingView.widget({
                "width": "100%",
                "height": "100%",
                "symbol": stock.symbol,
                "interval": "D",
                "timezone": "Asia/Tokyo",
                "theme": "dark",
                "style": "1",
                "locale": "ja",
                "toolbar_bg": "#0f1424",
                "enable_publishing": false,
                "hide_legend": true,
                "save_image": false,
                "container_id": "tradingview_chart"
            });
        } catch (err) {
            console.error("Failed to render TradingView widget:", err);
            chartContainer.innerHTML = `<div class="chart-placeholder"><p>チャートの読み込みに失敗しました (${err.message})</p></div>`;
        }
    } else {
        chartSection.style.display = "none";
        const linkContainer = document.getElementById("chartLinkContainer");
        if (linkContainer) linkContainer.style.display = "none";
    }
    
    // Fetch News
    fetchNewsForActiveStock();
    
    // Close sidebar on mobile after selection
    document.getElementById("sidebar").classList.remove("active");
}

function resetActiveStockUI() {
    document.getElementById("activeStockName").textContent = "銘柄を選択してください";
    document.getElementById("activeStockSymbol").textContent = "--:----";
    document.getElementById("chartSection").style.display = "none";
    const linkContainer = document.getElementById("chartLinkContainer");
    if (linkContainer) linkContainer.style.display = "none";
    document.getElementById("tradingview_chart").innerHTML = `
        <div class="chart-placeholder">
            <p>銘柄を選択するとリアルタイム株価チャートがここに表示されます</p>
        </div>
    `;
}

// --------------------------------------------------------------------------
// Stock List Render
// --------------------------------------------------------------------------
function renderStockList() {
    const listElement = document.getElementById("stockList");
    listElement.innerHTML = "";
    
    state.stocks.forEach(stock => {
        const li = document.createElement("li");
        li.className = `stock-item ${state.activeStockId === stock.id && !state.showBookmarks ? 'active' : ''}`;
        li.dataset.id = stock.id;
        
        li.innerHTML = `
            <div class="stock-item-info">
                <span class="stock-item-name">${stock.name}</span>
                <span class="stock-item-symbol">${stock.symbol || "ニュースのみ"}</span>
            </div>
            <button class="delete-stock-btn" aria-label="${stock.name}を削除">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px; height:16px;">
                    <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
        `;
        
        // Click stock to select
        li.addEventListener("click", (e) => {
            // Avoid triggering select if clicking delete button
            if (e.target.closest(".delete-stock-btn")) return;
            selectStock(stock.id);
        });
        
        // Delete stock handler
        const deleteBtn = li.querySelector(".delete-stock-btn");
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (confirm(`「${stock.name}」の登録を解除しますか？`)) {
                deleteStock(stock.id);
            }
        });
        
        listElement.appendChild(li);
    });
}

function deleteStock(stockId) {
    state.stocks = state.stocks.filter(s => s.id !== stockId);
    saveStocksToStorage();
    renderStockList();
    
    // If active stock was deleted, select another one or reset UI
    if (state.activeStockId === stockId) {
        if (state.stocks.length > 0) {
            selectStock(state.stocks[0].id);
        } else {
            state.activeStockId = null;
            localStorage.removeItem("sr_active_stock_id");
            resetActiveStockUI();
            renderNews();
        }
    }
    showToast("登録を削除しました");
}

// --------------------------------------------------------------------------
// News Engine & Fetching
// --------------------------------------------------------------------------
let cachedNews = {}; // In-memory cache for news feed by stock ID

function generateArticleId(link) {
    try {
        return btoa(encodeURIComponent(link)).substring(0, 32);
    } catch (e) {
        return Math.random().toString(36).substring(2, 15);
    }
}

function parseXmlFeed(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    
    const parserError = xmlDoc.getElementsByTagName("parsererror");
    if (parserError.length > 0) {
        throw new Error("XML parse error: " + parserError[0].textContent);
    }
    
    const items = xmlDoc.getElementsByTagName("item");
    const parsedArticles = [];
    const now = new Date();
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const rawTitle = item.getElementsByTagName("title")[0]?.textContent || "";
        const link = item.getElementsByTagName("link")[0]?.textContent || "";
        const pubDateStr = item.getElementsByTagName("pubDate")[0]?.textContent || "";
        const pubDate = new Date(pubDateStr);
        
        const parts = rawTitle.split(" - ");
        const source = parts.length > 1 ? parts.pop() : "Google ニュース";
        const cleanTitle = parts.join(" - ");
        
        const { sentiment, matchedKeywords, isImportant } = analyzeSentimentAndImportance(cleanTitle);
        const isNew = (now - pubDate) < (30 * 60 * 1000);
        
        parsedArticles.push({
            id: generateArticleId(link),
            title: cleanTitle,
            link,
            source,
            pubDate,
            sentiment,
            matchedKeywords,
            isImportant,
            isNew
        });
    }
    return parsedArticles;
}

function parseRss2JsonItems(items) {
    const parsedArticles = [];
    const now = new Date();
    
    items.forEach(item => {
        const rawTitle = item.title || "";
        const link = item.link || "";
        const pubDateStr = item.pubDate || "";
        const formattedDateStr = pubDateStr.includes(" ") ? pubDateStr.replace(" ", "T") + "Z" : pubDateStr;
        const pubDate = new Date(formattedDateStr);
        
        const parts = rawTitle.split(" - ");
        const source = parts.length > 1 ? parts.pop() : "Google ニュース";
        const cleanTitle = parts.join(" - ");
        
        const { sentiment, matchedKeywords, isImportant } = analyzeSentimentAndImportance(cleanTitle);
        const isNew = (now - pubDate) < (30 * 60 * 1000);
        
        parsedArticles.push({
            id: generateArticleId(link),
            title: cleanTitle,
            link,
            source,
            pubDate,
            sentiment,
            matchedKeywords,
            isImportant,
            isNew
        });
    });
    return parsedArticles;
}

async function fetchNewsForActiveStock(isManual = false) {
    if (!state.activeStockId || state.showBookmarks) return;
    
    const stock = state.stocks.find(s => s.id === state.activeStockId);
    if (!stock) return;
    
    const refreshIcon = document.querySelector(".refresh-icon");
    refreshIcon.classList.add("refreshing");
    
    // Render Loading Skeletons
    renderNewsSkeletons();
    
    // Construct Search Query: Name & important business/financial keywords
    const optimizedQuery = `(${stock.keyword}) AND (決算 OR 業績 OR 株価 OR 提携 OR 買収 OR 上方修正 OR 下方修正 OR 新製品)`;
    
    const hostname = window.location.hostname;
    const isLocal = hostname === "localhost" || 
                    hostname === "127.0.0.1" || 
                    hostname.startsWith("192.168.") || 
                    hostname.startsWith("10.") ||
                    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
                    
    const googleNewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(optimizedQuery)}&hl=ja&gl=JP&ceid=JP:ja`;
    
    let success = false;
    let parsedArticles = [];
    const now = new Date();
    
    try {
        if (isLocal) {
            // Local development: use custom python server proxy
            console.log("Fetching news via local server proxy...");
            const response = await fetch(`/api/news?q=${encodeURIComponent(optimizedQuery)}&t=${Date.now()}`);
            if (!response.ok) throw new Error("Local proxy server returned status " + response.status);
            const data = await response.json();
            if (data && data.contents) {
                parsedArticles = parseXmlFeed(data.contents);
                success = true;
            } else if (data && data.error) {
                throw new Error("Local proxy returned error: " + data.error);
            }
        } else {
            // Production deployment: try failover proxies
            const proxies = [
                {
                    name: "corsproxy.io",
                    fetch: async () => {
                        const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(googleNewsUrl)}`);
                        if (!res.ok) throw new Error("corsproxy.io returned status " + res.status);
                        const xmlText = await res.text();
                        return parseXmlFeed(xmlText);
                    }
                },
                {
                    name: "allorigins.win",
                    fetch: async () => {
                        const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(googleNewsUrl)}&t=${Date.now()}`);
                        if (!res.ok) throw new Error("allorigins.win returned status " + res.status);
                        const data = await res.json();
                        if (!data || !data.contents) throw new Error("allorigins.win returned empty contents");
                        return parseXmlFeed(data.contents);
                    }
                },
                {
                    name: "rss2json.com",
                    fetch: async () => {
                        const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(googleNewsUrl)}`);
                        if (!res.ok) throw new Error("rss2json.com returned status " + res.status);
                        const data = await res.json();
                        if (!data || data.status !== "ok" || !data.items) throw new Error("rss2json.com returned error status");
                        return parseRss2JsonItems(data.items);
                    }
                }
            ];
            
            for (const proxy of proxies) {
                try {
                    console.log(`Attempting fetch via ${proxy.name}...`);
                    parsedArticles = await proxy.fetch();
                    success = true;
                    console.log(`Fetch via ${proxy.name} succeeded!`);
                    break;
                } catch (err) {
                    console.warn(`Fetch via ${proxy.name} failed:`, err);
                }
            }
        }
        
        if (!success) {
            throw new Error("すべてのプロキシサーバーでニュースの取得に失敗しました");
        }
        
        // Cache parsed news
        cachedNews[stock.id] = parsedArticles;
        
        // Update Last Updated Timestamp
        const timeStr = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        document.getElementById("lastUpdated").textContent = `更新：${timeStr}`;
        
        if (isManual) {
            showToast("最新ニュースを取得しました");
        }
        
    } catch (err) {
        console.error("News fetch failed:", err);
        showToast("ニュースの取得に失敗しました", "error");
        if (!cachedNews[stock.id]) {
            cachedNews[stock.id] = [];
        }
    } finally {
        refreshIcon.classList.remove("refreshing");
        renderNews();
    }
}

// Sentiment analysis logic
function analyzeSentimentAndImportance(title) {
    let score = 0;
    let isImportant = false;
    let matchedKeywords = [];
    
    // Check positive words
    POSITIVE_KEYWORDS.forEach(kw => {
        if (title.includes(kw)) {
            score += 1;
            matchedKeywords.push({ word: kw, type: "pos" });
        }
    });
    
    // Check negative words
    NEGATIVE_KEYWORDS.forEach(kw => {
        if (title.includes(kw)) {
            score -= 1;
            matchedKeywords.push({ word: kw, type: "neg" });
        }
    });
    
    // Check generic important keywords
    IMPORTANT_KEYWORDS.forEach(kw => {
        if (title.includes(kw)) {
            isImportant = true;
            matchedKeywords.push({ word: kw, type: "imp" });
        }
    });
    
    // Calculate final states
    const sentiment = score > 0 ? "positive" : (score < 0 ? "negative" : "neutral");
    
    // Mark as important if it has high priority words OR multiple sentiment words
    if (matchedKeywords.length >= 2 || score > 0 || score < 0) {
        isImportant = true;
    }
    
    return {
        sentiment,
        matchedKeywords,
        isImportant
    };
}

// --------------------------------------------------------------------------
// News List Render
// --------------------------------------------------------------------------
function renderNews() {
    const listElement = document.getElementById("newsList");
    listElement.innerHTML = "";
    
    let articles = [];
    
    if (state.showBookmarks) {
        articles = state.bookmarkedArticles;
    } else if (state.activeStockId && cachedNews[state.activeStockId]) {
        articles = cachedNews[state.activeStockId];
    }
    
    // Apply filters
    if (state.showOnlyImportant) {
        articles = articles.filter(a => a.isImportant);
    }
    
    // Handle empty state
    if (articles.length === 0) {
        let title = "記事がありません";
        let message = "表示するニュースがありません。";
        let icon = "📰";
        
        if (state.showBookmarks) {
            title = "ブックマークはありません";
            message = "気になる記事のしおりアイコンをタップしてブックマークしましょう。";
            icon = "🔖";
        } else if (!state.activeStockId) {
            title = "登録銘柄がありません";
            message = "左側のメニューから銘柄を追加して最新ニュースを取得してください。";
            icon = "📈";
        } else if (state.showOnlyImportant) {
            title = "重要ニュースはありません";
            message = "フィルタキーワードに合致する重要なニュースは見つかりませんでした。";
            icon = "🔥";
        }
        
        listElement.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${icon}</div>
                <h3>${title}</h3>
                <p>${message}</p>
                ${!state.activeStockId ? '<button class="btn btn-primary" id="emptyStateAddBtn">銘柄を追加する</button>' : ''}
            </div>
        `;
        
        const btn = document.getElementById("emptyStateAddBtn");
        if (btn) {
            btn.addEventListener("click", () => document.getElementById("addModal").classList.add("active"));
        }
        return;
    }
    
    // Render articles
    articles.forEach(article => {
        const card = document.createElement("div");
        const isRead = state.readArticles.has(article.link);
        const isBookmarked = state.bookmarkedArticles.some(b => b.link === article.link);
        
        card.className = `news-card ${isRead ? 'read' : ''}`;
        
        // Construct Badges HTML
        let badgesHtml = "";
        if (article.isNew) {
            badgesHtml += `<span class="badge badge-new">新着✨</span>`;
        }
        if (article.isImportant) {
            badgesHtml += `<span class="badge badge-important">重要🔥</span>`;
        }
        if (article.sentiment === "positive") {
            badgesHtml += `<span class="badge badge-positive">好材料📈</span>`;
        } else if (article.sentiment === "negative") {
            badgesHtml += `<span class="badge badge-negative">懸念材料📉</span>`;
        }
        
        // Format Relative Time
        const relativeTime = formatRelativeTime(new Date(article.pubDate));
        
        // Highlight title text based on matching sentiment keywords
        let highlightedTitle = article.title;
        article.matchedKeywords.forEach(kw => {
            const cls = kw.type === "pos" ? "hl-pos" : (kw.type === "neg" ? "hl-neg" : "");
            if (!cls) return;
            
            // Simple replace
            const regex = new RegExp(`(${kw.word})`, 'gi');
            highlightedTitle = highlightedTitle.replace(regex, `<span class="${cls}">$1</span>`);
        });
        
        card.innerHTML = `
            <div class="news-card-meta">
                <span class="news-source">${article.source}</span>
                <span class="news-time">${relativeTime}</span>
                ${badgesHtml}
            </div>
            <h4 class="news-title">${highlightedTitle}</h4>
            <div class="news-card-footer">
                <span class="view-link" style="font-size:12px; color:var(--color-primary); font-weight:600;">記事を読む ↗</span>
                <button class="bookmark-card-btn ${isBookmarked ? 'bookmarked' : ''}" aria-label="ブックマーク">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                </button>
            </div>
        `;
        
        // Clicking the card opens the article
        card.addEventListener("click", (e) => {
            // Prevent opening link if user is clicking the bookmark button
            if (e.target.closest(".bookmark-card-btn")) return;
            
            markAsRead(article.link);
            window.open(article.link, "_blank", "noopener,noreferrer");
        });
        
        // Bookmark toggle handler
        const bookmarkBtn = card.querySelector(".bookmark-card-btn");
        bookmarkBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleBookmark(article);
        });
        
        listElement.appendChild(card);
    });
}

// Skeletons while fetching
function renderNewsSkeletons() {
    const listElement = document.getElementById("newsList");
    listElement.innerHTML = "";
    
    for (let i = 0; i < 4; i++) {
        const skeleton = document.createElement("div");
        skeleton.className = "skeleton-card";
        skeleton.innerHTML = `
            <div class="skeleton-meta skeleton-anim"></div>
            <div class="skeleton-title skeleton-anim"></div>
            <div class="skeleton-title-short skeleton-anim"></div>
            <div class="skeleton-footer skeleton-anim"></div>
        `;
        listElement.appendChild(skeleton);
    }
}

// --------------------------------------------------------------------------
// Article Actions (Read / Bookmarks)
// --------------------------------------------------------------------------
function markAsRead(link) {
    if (!state.readArticles.has(link)) {
        state.readArticles.add(link);
        saveReadArticlesToStorage();
        renderNews();
    }
}

function toggleBookmark(article) {
    const idx = state.bookmarkedArticles.findIndex(b => b.link === article.link);
    if (idx > -1) {
        state.bookmarkedArticles.splice(idx, 1);
        showToast("ブックマークを解除しました");
    } else {
        state.bookmarkedArticles.push(article);
        showToast("ブックマークに保存しました");
    }
    saveBookmarksToStorage();
    renderNews();
}

// --------------------------------------------------------------------------
// Polling & Timing Helper Functions
// --------------------------------------------------------------------------
function startAutoRefresh() {
    state.autoRefreshTimer = setInterval(() => {
        if (state.activeStockId && !state.showBookmarks) {
            console.log("Auto refreshing active stock news...");
            fetchNewsForActiveStock(false);
        }
    }, REFRESH_INTERVAL_MS);
}

function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (60 * 1000));
    const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
    
    if (diffMins < 1) return "現在";
    if (diffMins < 60) return `${diffMins}分前`;
    if (diffHours < 24) return `${diffHours}時間前`;
    
    // Otherwise return date
    return date.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

// --------------------------------------------------------------------------
// Feedback Toast Notification
// --------------------------------------------------------------------------
function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    
    const toast = document.createElement("div");
    toast.className = `toast glass ${type}`;
    
    const icon = type === "error" ? "⚠️" : "✨";
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    
    container.appendChild(toast);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.classList.add("toast-out");
        toast.addEventListener("animationend", () => {
            toast.remove();
        });
    }, 3000);
}

// --------------------------------------------------------------------------
// Viewport & Scroll Locking for iOS Safari (keyboard/iframe focus bug)
// --------------------------------------------------------------------------
let isInputFocused = false;

function resetViewportScroll() {
    const scrollRoot = document.scrollingElement || document.documentElement;
    const header = document.querySelector(".app-header");
    window.scrollTo(0, 0);
    scrollRoot.scrollTop = 0;
    scrollRoot.scrollLeft = 0;
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
    header?.scrollIntoView?.({ block: "start", inline: "nearest" });

    requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        scrollRoot.scrollTop = 0;
        scrollRoot.scrollLeft = 0;
        header?.scrollIntoView?.({ block: "start", inline: "nearest" });
    });
}

document.addEventListener("focusin", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        isInputFocused = true;
    }
});

document.addEventListener("focusout", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        isInputFocused = false;
        // Reset scroll when keyboard closes
        setTimeout(resetViewportScroll, 100);
        setTimeout(resetViewportScroll, 300);
        setTimeout(resetViewportScroll, 600);
    }
});

function lockViewportScroll() {
    if (window.matchMedia("(max-width: 768px)").matches) return;
    if (isInputFocused) return;
    
    if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
    }
    if (document.body.scrollTop !== 0 || document.body.scrollLeft !== 0) {
        document.body.scrollTop = 0;
        document.body.scrollLeft = 0;
    }
    if (document.documentElement.scrollTop !== 0 || document.documentElement.scrollLeft !== 0) {
        document.documentElement.scrollTop = 0;
        document.documentElement.scrollLeft = 0;
    }
}

// Attach passive scroll listeners to window and body
window.addEventListener("scroll", lockViewportScroll, { passive: true });
document.body.addEventListener("scroll", lockViewportScroll, { passive: true });
