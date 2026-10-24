(() => {
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  const $ = (selector) => document.querySelector(selector);
  const searchInput = $("#city-search");
  const resultsBox = $("#search-results");
  const clearButton = $("#clear-search");
  const historyList = $("#history-list");
  const weatherPanel = $("#weather-panel");
  const toast = $("#toast");

  const HISTORY_KEY = "weather72_recent_cities_v1";
  let searchTimer = null;
  let activeSearchId = 0;
  let toastTimer = null;
  let history = loadHistory();

  function loadHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
    } catch {
      return [];
    }
  }

  function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 3))); }
    catch { /* Storage may be unavailable in a restricted webview. */ }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function weatherDescription(code) {
    if (code === 0) return ["Ясно", "☀️"];
    if ([1, 2].includes(code)) return ["Небольшая облачность", "🌤️"];
    if (code === 3) return ["Пасмурно", "☁️"];
    if ([45, 48].includes(code)) return ["Туман", "🌫️"];
    if ([51, 53, 55, 56, 57].includes(code)) return ["Морось", "🌦️"];
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ["Дождь", "🌧️"];
    if ([71, 73, 75, 77, 85, 86].includes(code)) return ["Снег", "🌨️"];
    if ([95, 96, 99].includes(code)) return ["Гроза", "⛈️"];
    return ["Погодные условия", "🌡️"];
  }

  function renderHistory() {
    if (!history.length) {
      historyList.innerHTML = '<div class="empty-history">Здесь появятся города, погоду которых вы смотрели.</div>';
      return;
    }
    historyList.innerHTML = history.map((city, index) => {
      const temp = Number.isFinite(city.temperature) ? `${Math.round(city.temperature)}°` : "—";
      const icon = city.icon || "🌤️";
      return `<button class="history-card" type="button" data-history-index="${index}">
        <span class="history-city">${escapeHtml(city.name)}</span>
        <span class="history-meta">${escapeHtml(city.admin1 || "Россия")}</span>
        <span class="history-temp">${temp}</span>
        <span class="history-icon">${icon}</span>
      </button>`;
    }).join("");
  }

  function renderResults(cities) {
    if (!cities.length) {
      resultsBox.innerHTML = '<div class="result-button"><span class="result-main">Ничего не найдено. Попробуйте другое название.</span></div>';
      resultsBox.hidden = false;
      return;
    }
    resultsBox.innerHTML = cities.map((city, index) => `
      <button class="result-button" type="button" data-result-index="${index}">
        <span class="result-pin">📍</span>
        <span class="result-main">
          <span class="result-city">${escapeHtml(city.name)}</span>
          <span class="result-region">${escapeHtml([city.admin1, city.country].filter(Boolean).join(", "))}</span>
        </span>
        <span aria-hidden="true">›</span>
      </button>`).join("");
    resultsBox.hidden = false;
    resultsBox._cities = cities;
  }

  async function searchCities(query) {
    const id = ++activeSearchId;
    if (query.trim().length < 2) {
      resultsBox.hidden = true;
      return;
    }
    resultsBox.innerHTML = '<div class="result-button"><span class="result-main">Ищем города…</span></div>';
    resultsBox.hidden = false;
    try {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.search = new URLSearchParams({
        name: query.trim(), count: "20", language: "ru", format: "json"
      }).toString();
      const response = await fetch(url);
      if (!response.ok) throw new Error("Не удалось выполнить поиск");
      const data = await response.json();
      if (id !== activeSearchId) return;
      const cities = (data.results || [])
        .filter(city => city.country_code === "RU")
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ru"));
      renderResults(cities);
    } catch (error) {
      if (id !== activeSearchId) return;
      resultsBox.innerHTML = '<div class="result-button"><span class="result-main">Не удалось выполнить поиск. Проверьте интернет и попробуйте снова.</span></div>';
      resultsBox.hidden = false;
    }
  }

  async function loadWeather(city, fromHistory = false) {
    resultsBox.hidden = true;
    searchInput.blur();
    weatherPanel.innerHTML = '<div class="weather-placeholder"><div class="sun-art">⏳</div><h2>Загружаем погоду…</h2><p>Получаем актуальные данные для выбранного города.</p></div>';

    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.search = new URLSearchParams({
        latitude: String(city.latitude),
        longitude: String(city.longitude),
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
        timezone: "auto",
        forecast_days: "1"
      }).toString();
      const response = await fetch(url);
      if (!response.ok) throw new Error("Не удалось получить погоду");
      const data = await response.json();
      const current = data.current;
      const [description, icon] = weatherDescription(current.weather_code);

      const item = {
        id: city.id ?? `${city.latitude},${city.longitude}`,
        name: city.name,
        admin1: city.admin1 || "",
        country: city.country || "Россия",
        latitude: city.latitude,
        longitude: city.longitude,
        temperature: current.temperature_2m,
        icon,
        seenAt: Date.now()
      };
      history = [item, ...history.filter(old => String(old.id) !== String(item.id))].slice(0, 3);
      saveHistory();
      renderHistory();
      renderWeather(item, current, description, icon, data.current_units || {});
    } catch (error) {
      weatherPanel.innerHTML = '<div class="weather-placeholder"><div class="sun-art">⚠️</div><h2>Не удалось загрузить погоду</h2><p>Проверь интернет-соединение и попробуй ещё раз.</p></div>';
      showToast("Не удалось получить погоду. Попробуйте ещё раз.");
    }
  }

  function renderWeather(city, current, description, icon, units) {
    const locationLine = [city.admin1, city.country || "Россия"].filter(Boolean).join(", ");
    const time = current.time ? new Date(current.time).toLocaleString("ru-RU", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
    }) : "";
    weatherPanel.innerHTML = `
      <article class="weather-card">
        <div class="weather-card-top">
          <div>
            <h2 class="weather-location">${escapeHtml(city.name)}</h2>
            <div class="weather-region">${escapeHtml(locationLine)}</div>
          </div>
          <div class="weather-icon" aria-hidden="true">${icon}</div>
        </div>
        <div class="weather-temp-row">
          <div class="weather-temp">${Math.round(current.temperature_2m)}°</div>
          <div>
            <div class="weather-desc">${escapeHtml(description)}</div>
            <div class="feels">Ощущается как ${Math.round(current.apparent_temperature)}°</div>
          </div>
        </div>
        <div class="metrics">
          <div class="metric"><span class="metric-label">Влажность</span><span class="metric-value">${Math.round(current.relative_humidity_2m)}%</span></div>
          <div class="metric"><span class="metric-label">Ветер</span><span class="metric-value">${Math.round(current.wind_speed_10m)} ${escapeHtml(units.wind_speed_10m || "км/ч")}</span></div>
          <div class="metric"><span class="metric-label">Осадки</span><span class="metric-value">${Number(current.precipitation).toLocaleString("ru-RU")} ${escapeHtml(units.precipitation || "мм")}</span></div>
        </div>
        <p class="status">${time ? `Обновлено: ${escapeHtml(time)} · ` : ""}Город добавлен в историю последних просмотров.</p>
      </article>`;
  }

  searchInput.addEventListener("input", () => {
    clearButton.hidden = !searchInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchCities(searchInput.value), 300);
  });

  clearButton.addEventListener("click", () => {
    searchInput.value = "";
    clearButton.hidden = true;
    resultsBox.hidden = true;
    searchInput.focus();
  });

  resultsBox.addEventListener("click", event => {
    const button = event.target.closest("[data-result-index]");
    if (!button || !resultsBox._cities) return;
    const city = resultsBox._cities[Number(button.dataset.resultIndex)];
    if (city) loadWeather(city);
  });

  historyList.addEventListener("click", event => {
    const button = event.target.closest("[data-history-index]");
    if (!button) return;
    const city = history[Number(button.dataset.historyIndex)];
    if (city) loadWeather(city, true);
  });

  document.addEventListener("click", event => {
    if (!event.target.closest(".search-section")) resultsBox.hidden = true;
  });

  renderHistory();
})();
