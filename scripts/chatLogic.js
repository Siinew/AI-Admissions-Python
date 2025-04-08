const chatLog = document.getElementById('chatLog');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const suggestions = document.querySelectorAll('.suggestion');

//const API_URL = 'https://ai-admissions-python-production.up.railway.app/api/query'; this is the production URL
const API_URL = 'https://github-dev-for-ai-admissions-production.up.railway.app/api/query'; //DEV URL

const PERSONA_ID = 'Adam';


function addMessage(text, sender) {
  const isMobile = window.innerWidth <= 768;
  const msg = document.createElement('div');
  msg.className = 'message ' + sender;

  if (sender === 'ai' && isMobile) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = "Tap to view answer";
    details.appendChild(summary);

    const content = document.createElement('div');
    content.innerHTML = text;
    details.appendChild(content);

    msg.appendChild(details);
  } else {
    msg.innerHTML = text;
  }

  chatLog.appendChild(msg);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function handleUserMessage(text) {
  if (!text.trim()) return;

  const keepHistory = document.getElementById('chatHistoryToggle').checked;

  addMessage(text, 'user');
  userInput.value = '';
  addMessage("Thinking...", 'ai');

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text, persona_id: PERSONA_ID })
    });

    const data = await response.json();

    const messages = chatLog.querySelectorAll('.ai');
    if (messages.length > 0) messages[messages.length - 1].remove();

    if (!keepHistory) {
      const allMessages = chatLog.querySelectorAll('.message.ai, .message.user');
      allMessages.forEach((msg, index) => {
        if (index >= 2) {
          msg.classList.add('fade-out');
          setTimeout(() => msg.remove(), 500);
        }
      });
    }

    if (data.response) {
      let cleaned = data.response;

      const playMatch = cleaned.match(/\[SHOW_(SLIDESHOW|VIDEO|SYLLABUS):([^\]]+)\]/);
      if (playMatch) {
        const type = playMatch[1];
        const tag = playMatch[2];
        cleaned = cleaned.replace(playMatch[0], '').trim();
        addMessage(cleaned, 'ai');
        await loadDynamicContent(type, tag);
        return;
      }

      const offerMatch = cleaned.match(/\[SHOW_OFFER:([a-z,]+):([^\]]+)\]/i);
      if (offerMatch) {
        const typesRaw = offerMatch[1];
        const tag = offerMatch[2];
        const types = typesRaw.toUpperCase().split(',');

        cleaned = cleaned.replace(offerMatch[0], '').trim();

        const container = document.createElement('div');
        container.className = 'message ai';

        const content = document.createElement('div');
        content.innerHTML = cleaned;

        const buttonWrapper = document.createElement('div');
        buttonWrapper.style.marginTop = '10px';
        buttonWrapper.style.display = 'flex';
        buttonWrapper.style.gap = '10px';
        buttonWrapper.style.flexWrap = 'wrap';

        types.forEach(type => {
          const btn = document.createElement('button');
          btn.textContent = type.charAt(0) + type.slice(1).toLowerCase();
          btn.className = 'media-toggle-btn';
          btn.onclick = () => {
            btn.disabled = true;
            loadDynamicContent(type, tag);
          };
          buttonWrapper.appendChild(btn);
        });

        container.appendChild(content);
        container.appendChild(buttonWrapper);
        chatLog.appendChild(container);
        chatLog.scrollTop = chatLog.scrollHeight;
        return;
      }

      addMessage(cleaned, 'ai');
    } else {
      addMessage(data.error || "Sorry, something went wrong.", 'ai');
    }
  } catch (err) {
    addMessage("Fetch error: " + err.message, 'ai');
  }
}

sendBtn.addEventListener('click', () => handleUserMessage(userInput.value));
userInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleUserMessage(userInput.value);
});
suggestions.forEach(suggestion => {
  suggestion.addEventListener('click', () => {
    handleUserMessage(suggestion.textContent);
  });
});

async function loadDynamicContent(type, key) {
  try {
    const response = await fetch("https://ai-admissions-python-production.up.railway.app/api/media-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: type, tag: key })
    });

    const result = await response.json();
    if (!result || result.length === 0) {
      addMessage("Sorry, I couldn’t find the requested visuals.", 'ai');
      return;
    }

    switch (type) {
      case "SLIDESHOW":
        startSlideshow(result);
        break;
      case "VIDEO":
        const video = result[0];
        playVideoOverlay(video.media_url, video.caption);
        break;
      case "SYLLABUS":
        const syllabus = result[0];
        showSyllabus(syllabus.caption.split("\n"));
        break;
      default:
        console.warn("Unknown content type:", type);
    }
  } catch (err) {
    console.error("❌ Error fetching visual media:", err);
    addMessage("There was a problem loading visuals.", 'ai');
  }
}

let currentSlideIndex = 0;
let currentSlides = [];
let slideshowTimer = null;

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
  currentSlideIndex = 0;
  currentSlides = [];
  if (slideshowTimer) {
    clearInterval(slideshowTimer);
    slideshowTimer = null;
  }
}

function playVideoOverlay(videoSrc, captionText) {
  const overlay = document.getElementById("videoOverlay");
  const container = document.getElementById("videoContainer");
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

function showSyllabus(lines) {
  const container = document.getElementById("syllabusText");
  container.innerHTML = lines.map(line => `<div>• ${line}</div>`).join("");
  document.getElementById("syllabusOverlay").style.display = "flex";
}

function closeSyllabus() {
  document.getElementById("syllabusOverlay").style.display = "none";
}

document.getElementById("closeSlideshow").addEventListener("click", closeSlideshow);
document.getElementById("nextSlide").addEventListener("click", nextSlide);
document.getElementById("prevSlide").addEventListener("click", prevSlide);