// 🔗 Must be included after sessionLogic.js

const API_URL = 'http://localhost:8001/api/query';
const MEDIA_API_URL = 'http://localhost:8001/api/media-match';
const PERSONA_ID = 'Adam';

const chatLog = document.getElementById('chatLog');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const suggestions = document.querySelectorAll('.suggestion');

// Event Listeners
sendBtn.addEventListener('click', () => handleUserMessage(userInput.value));
userInput.addEventListener('keypress', e => {
  if (e.key === 'Enter') handleUserMessage(userInput.value);
});
suggestions.forEach(s => s.addEventListener('click', () => handleUserMessage(s.textContent)));

document.addEventListener("DOMContentLoaded", () => {
  console.log("🔧 DOM fully loaded");

  document.getElementById("closeSlideshow")?.addEventListener("click", closeSlideshow);
  document.getElementById("nextSlide")?.addEventListener("click", nextSlide);
  document.getElementById("prevSlide")?.addEventListener("click", prevSlide);
  document.getElementById("closeVideo")?.addEventListener("click", closeVideo);
  document.getElementById("showUpcomingBtn")?.addEventListener("click", fetchUpcomingClasses);
  document.getElementById("closeSyllabus")?.addEventListener("click", closeSyllabus);
});

// Message handling
function addMessage(text, sender) {
  const msg = document.createElement('div');
  msg.className = 'message ' + sender;
  msg.innerHTML = text;
  chatLog.appendChild(msg);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function handleUserMessage(text) {
  if (!text.trim()) return;
  addMessage(text, 'user');
  userInput.value = '';
  addMessage("Thinking...", 'ai');

  const metadataOnce = getMetadataPayloadOnce();

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: text,
        persona_id: PERSONA_ID,
        session_id: SESSION_ID,
        metadata: metadataOnce
      })
    });

    const data = await res.json();
    const aiMsgs = chatLog.querySelectorAll('.message.ai');
    if (aiMsgs.length) aiMsgs[aiMsgs.length - 1].remove();

    if (data.response) addMessage(data.response, 'ai');
  } catch (err) {
    addMessage("Fetch error: " + err.message, 'ai');
  }
}

// Visual media fetch
async function fetchMedia(type, tag) {
  try {
    const res = await fetch(MEDIA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, tag })
    });

    const media = await res.json();
    if (!Array.isArray(media) || media.length === 0) {
      addMessage("No visuals found for that category.", 'ai');
      return;
    }

    switch (type) {
      case 'SLIDESHOW':
        startSlideshow(media.map(item => ({ src: item.media_url, caption: item.caption })));
        break;
      case 'VIDEO':
        const video = media[0];
        playVideoOverlay(video.media_url, video.caption);
        break;
      case 'SYLLABUS':
        const syllabusData = media[0];
        try {
          const raw = syllabusData.syllabus_json;
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed)) {
            showSyllabus(parsed, syllabusData.caption);
          } else {
            addMessage("Syllabus format error: Not a valid array.", 'ai');
          }
        } catch (err) {
          console.error("❌ Failed to parse syllabus JSON:", err);
          addMessage("Syllabus format error: Could not parse data.", 'ai');
        }
        break;
      default:
        addMessage("Unknown media type.", 'ai');
    }
  } catch (err) {
    console.error("❌ Media fetch error:", err);
    addMessage("Failed to load visual content.", 'ai');
  }
}

// Slideshow
let currentSlideIndex = 0;
let currentSlides = [];

function startSlideshow(slides) {
  currentSlides = slides;
  currentSlideIndex = 0;
  renderSlide(currentSlideIndex);
  document.getElementById("slideshowContainer").style.display = "block";
}

function renderSlide(index) {
  const img = document.getElementById("slideImage");
  const caption = document.getElementById("slideCaption");
  img.classList.remove('fade-in');
  img.style.opacity = 0;

  setTimeout(() => {
    const slide = currentSlides[index];
    img.src = slide.src;
    caption.textContent = slide.caption;
    img.onload = () => {
      img.classList.add('fade-in');
      img.style.opacity = 1;
    };
  }, 100);
}

function nextSlide() {
  currentSlideIndex = (currentSlideIndex + 1) % currentSlides.length;
  renderSlide(currentSlideIndex);
}

function prevSlide() {
  currentSlideIndex = (currentSlideIndex - 1 + currentSlides.length) % currentSlides.length;
  renderSlide(currentSlideIndex);
}

function closeSlideshow() {
  document.getElementById("slideshowContainer").style.display = "none";
}

// Video
function playVideoOverlay(videoSrc, captionText) {
  const overlay = document.getElementById("videoOverlay");
  const video = document.getElementById("videoPlayer");
  const caption = document.getElementById("videoCaption");

  video.src = videoSrc;
  caption.textContent = captionText;
  overlay.style.display = "flex";
}

function closeVideo() {
  const video = document.getElementById("videoPlayer");
  video.pause();
  video.src = "";
  document.getElementById("videoOverlay").style.display = "none";
}

// Syllabus
function showSyllabus(items, caption) {
  const container = document.getElementById("syllabusText");
  container.innerHTML = "";

  if (caption) {
    const title = document.createElement('h3');
    title.textContent = caption;
    title.style.marginBottom = '16px';
    container.appendChild(title);
  }

  items.forEach(item => {
    const panel = document.createElement('div');
    panel.className = 'syllabus-panel';

    const header = document.createElement('div');
    header.className = 'syllabus-header';

    const icon = document.createElement('span');
    icon.className = 'toggle-icon';
    icon.textContent = '+';

    const titleText = document.createElement('span');
    titleText.textContent = item.title || "Untitled";

    header.appendChild(titleText);
    header.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'syllabus-body';
    body.textContent = item.description || "";

    header.addEventListener('click', () => {
      const expanded = panel.classList.toggle('expanded');
      icon.textContent = expanded ? '–' : '+';
    });

    panel.appendChild(header);
    panel.appendChild(body);
    container.appendChild(panel);
  });

  document.getElementById("syllabusOverlay").style.display = "flex";
}

function closeSyllabus() {
  document.getElementById("syllabusOverlay").style.display = "none";
}

// Upcoming classes
async function fetchUpcomingClasses() {
  try {
    const res = await fetch('http://localhost:8001/api/upcoming-classes');
    const data = await res.json();
    renderUpcomingOverlay(data);
  } catch (err) {
    console.error("Failed to load upcoming classes:", err);
  }
}

function renderUpcomingOverlay(classes) {
  const list = document.getElementById("upcomingList");
  list.innerHTML = '';

  if (!classes.length) {
    list.innerHTML = '<p>No upcoming classes found.</p>';
  } else {
    classes.forEach(cls => {
      const div = document.createElement("div");
      div.className = "upcoming-class";
      div.innerHTML = `
        <h4>${cls.course_name}</h4>
        <p><strong>Location:</strong> ${cls.course_location}<br>
           <strong>Length:</strong> ${cls.course_length}<br>
           <strong>Start Date:</strong> ${new Date(cls.start_date).toLocaleDateString()}</p>
        <a href="${cls.registration_link}" target="_blank">Register & Info</a>
      `;
      list.appendChild(div);
    });
  }

  document.getElementById("upcomingOverlay").style.display = "flex";
}

function closeUpcoming() {
  document.getElementById("upcomingOverlay").style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  const loadBtn = document.getElementById("loadSelectedVisuals");
  if (loadBtn) {
    loadBtn.addEventListener("click", () => {
      const program = document.querySelector('input[name="program"]:checked')?.value;
      const mediaType = document.querySelector('input[name="mediaType"]:checked')?.value;
      if (program && mediaType) {
        fetchMedia(mediaType.toUpperCase(), program);
      }
    });
  }
});
