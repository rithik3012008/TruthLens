from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

import os
import re
import io
import json
import socket
import ipaddress
import xml.etree.ElementTree as ET

import joblib
import requests
import pytesseract

from PIL import Image
from bs4 import BeautifulSoup
from urllib.parse import urlparse, quote_plus


# ============================================================
# FLASK SETUP
# ============================================================

app = Flask(__name__)
CORS(app)

# Tesseract path
import shutil

tesseract_path = shutil.which("tesseract")

if tesseract_path:
    pytesseract.pytesseract.tesseract_cmd = tesseract_path
elif os.path.exists(r"C:\Program Files\Tesseract-OCR\tesseract.exe"):
    pytesseract.pytesseract.tesseract_cmd = (
        r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    )


# ============================================================
# MODEL LOADING
# ============================================================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(SCRIPT_DIR, "..", "model")

# Frontend directory. This allows detector.html and its JS/CSS files
# to be opened through Flask instead of file:/// in the browser.
FRONTEND_DIR = os.path.abspath(
    os.path.join(SCRIPT_DIR, "..", "frontend")
)

model_path = os.path.join(MODEL_DIR, "fake_news_model.pkl")
vectorizer_path = os.path.join(MODEL_DIR, "tfidf_vectorizer.pkl")

model = None
vectorizer = None
FEATURE_NAMES = []
COEFFICIENTS = []

try:
    model = joblib.load(model_path)
    print("Model loaded:", model_path)
except Exception as e:
    print("ERROR loading model:", e)

try:
    vectorizer = joblib.load(vectorizer_path)
    print("Vectorizer loaded:", vectorizer_path)
except Exception as e:
    print("ERROR loading vectorizer:", e)

if vectorizer is not None:
    try:
        FEATURE_NAMES = vectorizer.get_feature_names_out()
    except Exception:
        FEATURE_NAMES = []

if model is not None:
    try:
        COEFFICIENTS = model.coef_[0]
    except Exception:
        COEFFICIENTS = []


# ============================================================
# SETTINGS
# ============================================================

MIN_TEXT_LENGTH = 25
CONFIDENCE_THRESHOLD = 70
REQUEST_TIMEOUT = 12


URL_PATTERN = re.compile(
    r"^(https?://\S+|www\.\S+)$",
    re.IGNORECASE
)


# ============================================================
# KNOWN NEWS DOMAINS
# ============================================================

KNOWN_NEWS_DOMAINS = {
    "reuters.com",
    "www.reuters.com",

    "bbc.com",
    "www.bbc.com",

    "apnews.com",
    "www.apnews.com",

    "thehindu.com",
    "www.thehindu.com",

    "theguardian.com",
    "www.theguardian.com",

    "npr.org",
    "www.npr.org",

    "aljazeera.com",
    "www.aljazeera.com",

    "nytimes.com",
    "www.nytimes.com",

    "washingtonpost.com",
    "www.washingtonpost.com",

    "indianexpress.com",
    "www.indianexpress.com",

    "hindustantimes.com",
    "www.hindustantimes.com",

    "timesofindia.indiatimes.com",

    "ndtv.com",
    "www.ndtv.com",

    "yahoo.com",
    "www.yahoo.com",
    "news.yahoo.com",

    "cnn.com",
    "www.cnn.com",

    "cnbc.com",
    "www.cnbc.com",

    "bloomberg.com",
    "www.bloomberg.com",

    "independent.co.uk",
    "www.independent.co.uk",

    "telegraph.co.uk",
    "www.telegraph.co.uk",

    "news.sky.com",

    "abc.net.au",
    "www.abc.net.au",

    "cbc.ca",
    "www.cbc.ca",

    "dw.com",
    "www.dw.com",

    "france24.com",
    "www.france24.com",

    "indiatoday.in",
    "www.indiatoday.in",

    "news18.com",
    "www.news18.com",

    "livemint.com",
    "www.livemint.com",

    "business-standard.com",
    "www.business-standard.com",

    "deccanherald.com",
    "www.deccanherald.com",

    "thequint.com",
    "www.thequint.com",

    "scroll.in",
    "www.scroll.in",

    "thewire.in",
    "www.thewire.in",

    "economictimes.indiatimes.com",
    "timesofindia.indiatimes.com",
}
# ============================================================
# BASIC HELPERS
# ============================================================

def clean_text(text):
    if not text:
        return ""

    text = str(text).lower()

    # Remove URLs
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"www\.\S+", " ", text)

    # Keep letters and spaces
    text = re.sub(r"[^a-zA-Z\s]", " ", text)

    # Normalize whitespace
    text = re.sub(r"\s+", " ", text).strip()

    return text

OCR_NOISE_LINE_KEYWORDS = re.compile(
    r"(subscribe now|sign ?in|log ?in|newsletter|marketplace|"
    r"advertise|obituaries|enewspaper|legals|cookie policy|"
    r"privacy policy|terms of service|q ?search|"
    r"picture credit|photo credit|image credit|"
    r"\b(save|comments?|share|sprint|follow|like|"
    r"bookmark|print)\b)",
    re.IGNORECASE
)

def strip_ocr_chrome_noise(text):
    """
    Screenshots of a full browser window (not just the article) often
    contain OCR-readable browser chrome: tab titles, the address bar,
    nav menus, subscribe banners. Left in, this noise gets fed straight
    into the TF-IDF vectorizer alongside the real article text and can
    skew the prediction. This strips lines that look like chrome rather
    than article content, before analysis.
    """
    if not text:
        return ""

    lines = text.split("\n")
    cleaned_lines = []

    for line in lines:
        stripped = line.strip()

        if not stripped:
            continue

        # Browser tab bars tend to cram several tab titles onto one
        # line, separated by pipe characters
        if stripped.count("|") >= 2:
            continue

        # Common browser chrome / site navigation phrases
        if OCR_NOISE_LINE_KEYWORDS.search(stripped):
            continue

        # Very short fragments (nav labels, single words, stray tab
        # "x" close markers) rarely carry article meaning on their own
        word_count = len(stripped.split())
        if word_count <= 2 and len(stripped) <= 20:
            continue

        cleaned_lines.append(stripped)

    return "\n".join(cleaned_lines).strip()


def is_url(text):
    if not text:
        return False

    text = text.strip()

    return bool(URL_PATTERN.match(text))


def normalize_url(url):
    url = url.strip()

    if url.lower().startswith("www."):
        url = "https://" + url

    elif not re.match(r"^https?://", url, re.IGNORECASE):
        url = "https://" + url

    return url


def get_domain(url):
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()

        if "@" in domain:
            domain = domain.split("@")[-1]

        if ":" in domain:
            domain = domain.split(":")[0]

        return domain

    except Exception:
        return ""


GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_MODEL = "llama-3.3-70b-versatile"
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

# Domain -> result dict, kept for the life of the process so the same
# unfamiliar domain isn't re-sent to the LLM on every request.
_domain_reputation_cache = {}


def check_domain_with_llm(domain):
    """
    For a domain NOT on the fixed KNOWN_NEWS_DOMAINS list, ask an LLM
    (via Groq) whether it looks like a reputable news source, a
    questionable one, or unknown. Cached per domain per process.

    Returns None (rather than raising) on any failure, so a missing key
    or a network hiccup just skips this check instead of breaking
    /predict.
    """
    if not domain:
        return None

    if domain in _domain_reputation_cache:
        return _domain_reputation_cache[domain]

    if not GROQ_API_KEY:
        return None

    prompt = (
        "Domain: {}\n\n"
        "Based on what you know about this website, classify it as "
        "exactly one of: reputable_news, questionable, or unknown. "
        "Reply with ONLY a JSON object and nothing else, in this exact "
        'shape: {{"verdict": "reputable_news", "reason": "one short '
        'sentence"}}'
    ).format(domain)

    result = None

    try:
        response = requests.post(
            GROQ_ENDPOINT,
            headers={
                "Authorization": "Bearer " + GROQ_API_KEY,
                "Content-Type": "application/json"
            },
            json={
                "model": GROQ_MODEL,
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0,
                "max_tokens": 120
            },
            timeout=8
        )

        response.raise_for_status()

        content = response.json()["choices"][0]["message"]["content"]
        content = content.strip()

        # In case the model wraps the JSON in a markdown code fence anyway.
        content = re.sub(
            r"^```(?:json)?|```$",
            "",
            content,
            flags=re.MULTILINE
        ).strip()

        parsed = json.loads(content)

        verdict = parsed.get("verdict", "unknown")

        if verdict not in ("reputable_news", "questionable", "unknown"):
            verdict = "unknown"

        result = {
            "verdict": verdict,
            "reason": str(parsed.get("reason", ""))[:200]
        }

    except Exception as e:
        print("LLM domain check error:", repr(e))
        result = None

    _domain_reputation_cache[domain] = result
    return result


def get_domain_info(url):
    domain = get_domain(url)
    is_known = domain in KNOWN_NEWS_DOMAINS

    info = {
        "domain": domain,
        "is_known_outlet": is_known,
        "llm_checked": False,
        "llm_verdict": None,
        "llm_reason": None
    }

    # Only spend an LLM call on domains the fixed list doesn't cover.
    if domain and not is_known:

        llm_result = check_domain_with_llm(domain)

        if llm_result:
            info["llm_checked"] = True
            info["llm_verdict"] = llm_result["verdict"]
            info["llm_reason"] = llm_result["reason"]

    return info


# ============================================================
# URL SAFETY
# ============================================================

def is_safe_public_url(url):
    """
    Blocks localhost/private/internal IP addresses.
    Allows normal public websites.
    """

    try:
        parsed = urlparse(url)

        if parsed.scheme.lower() not in ("http", "https"):
            return False

        hostname = parsed.hostname

        if not hostname:
            return False

        hostname = hostname.lower()

        # Explicitly block local/internal names
        blocked_names = {
            "localhost",
            "localhost.localdomain",
            "127.0.0.1",
            "::1",
            "0.0.0.0"
        }

        if hostname in blocked_names:
            return False

        # Direct IP address
        try:
            ip = ipaddress.ip_address(hostname)

            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_reserved
                or ip.is_multicast
            ):
                return False

            return True

        except ValueError:
            pass

        # Resolve domain
        try:
            addresses = socket.getaddrinfo(
                hostname,
                None,
                socket.AF_UNSPEC
            )

            has_address = False
            has_public_address = False

            for result in addresses:
                ip_text = result[4][0]

                try:
                    ip = ipaddress.ip_address(ip_text)
                except ValueError:
                    continue

                has_address = True

                if not (
                    ip.is_private
                    or ip.is_loopback
                    or ip.is_link_local
                    or ip.is_reserved
                    or ip.is_multicast
                ):
                    has_public_address = True
                    break

            # Only reject if DNS resolved addresses AND every single
            # one of them is private/loopback/reserved. A domain that
            # resolves to a MIX of addresses (common with IPv6, VPNs,
            # some campus networks) just needs ONE usable public
            # address to be safe - rejecting on the first private-
            # looking entry in the list was blocking legitimate public
            # sites like bbc.com.
            if has_address and not has_public_address:
                return False

        except Exception:
            # Don't reject a normal public domain merely because
            # local DNS resolution failed.
            pass

        return True

    except Exception as e:
        print("URL safety check error:", e)
        return False


# ============================================================
# ARTICLE EXTRACTION
# ============================================================

def fetch_article_text(url):
    result = {
        "text": "",
        "article_text": "",
        "title": "",
        "description": "",
        "url": url,
        "has_article_text": False,
        "error": None
    }

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 "
            "(KHTML, like Gecko) "
            "Chrome/139.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9"
    }

    try:
        response = requests.get(
            url,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
            allow_redirects=True
        )

        response.raise_for_status()

        html = response.text

        soup = BeautifulSoup(html, "html.parser")

        # ----------------------------------------------------
        # TITLE
        # ----------------------------------------------------

        title = ""

        h1 = soup.find("h1")

        if h1:
            title = h1.get_text(" ", strip=True)

        if not title and soup.title:
            title = soup.title.get_text(" ", strip=True)

        # ----------------------------------------------------
        # DESCRIPTION
        # ----------------------------------------------------

        description = ""

        meta_description = soup.find(
            "meta",
            attrs={"name": re.compile("^description$", re.I)}
        )

        if meta_description:
            description = meta_description.get("content", "").strip()

        if not description:
            og_description = soup.find(
                "meta",
                attrs={"property": "og:description"}
            )

            if og_description:
                description = og_description.get(
                    "content",
                    ""
                ).strip()

        # ----------------------------------------------------
        # REMOVE UNWANTED ELEMENTS
        # ----------------------------------------------------

        for element in soup([
            "script",
            "style",
            "noscript",
            "svg",
            "nav",
            "footer",
            "header",
            "form",
            "aside",
            "iframe"
        ]):
            element.decompose()

        # ----------------------------------------------------
        # ARTICLE PARAGRAPHS
        # ----------------------------------------------------

        article_paragraphs = []

        article = soup.find("article")

        if article:
            paragraphs = article.find_all("p")

            for p in paragraphs:
                text = p.get_text(" ", strip=True)

                if len(text) >= 30:
                    article_paragraphs.append(text)

        # ----------------------------------------------------
        # FALLBACK: ALL PARAGRAPHS
        # ----------------------------------------------------

        if not article_paragraphs:
            paragraphs = soup.find_all("p")

            for p in paragraphs:
                text = p.get_text(" ", strip=True)

                if len(text) >= 30:
                    article_paragraphs.append(text)

        # Remove duplicates
        cleaned_paragraphs = []

        seen = set()

        for paragraph in article_paragraphs:
            key = paragraph.lower().strip()

            if key not in seen:
                seen.add(key)
                cleaned_paragraphs.append(paragraph)

        article_text = "\n\n".join(cleaned_paragraphs)

        # ----------------------------------------------------
        # LIMIT EXTREMELY LARGE PAGES
        # ----------------------------------------------------

        if len(article_text) > 30000:
            article_text = article_text[:30000]

        # Metadata fallback
        metadata_text = " ".join(
            part for part in [title, description]
            if part
        )

        # Main extracted text
        combined_text = article_text.strip()

        if not combined_text:
            combined_text = metadata_text.strip()

        result["article_text"] = article_text.strip()
        result["text"] = combined_text
        result["title"] = title
        result["description"] = description
        result["has_article_text"] = (
            len(clean_text(article_text)) >= MIN_TEXT_LENGTH
        )

        return result

    except requests.exceptions.Timeout:
        result["error"] = "The website took too long to respond."

    except requests.exceptions.RequestException as e:
        result["error"] = f"Could not access the webpage: {str(e)}"

    except Exception as e:
        result["error"] = f"Article extraction failed: {str(e)}"

    return result


# ============================================================
# URL ANALYSIS FALLBACK
# ============================================================

def build_url_fallback_text(url, title="", description=""):
    """
    Build fallback analysis text when a webpage does not expose
    enough readable article content.

    Priority:
    1. Full article text is handled by fetch_article_text().
    2. Title + description.
    3. URL slug converted into readable words.

    The URL slug is only a limited analysis fallback.
    It is NOT treated as factual evidence.
    """

    title = str(title or "").strip()
    description = str(description or "").strip()

    metadata_parts = [
        part for part in [title, description]
        if part
    ]

    metadata_text = " ".join(metadata_parts).strip()

    # --------------------------------------------------------
    # TITLE + DESCRIPTION FALLBACK
    # --------------------------------------------------------

    if len(clean_text(metadata_text)) >= MIN_TEXT_LENGTH:
        return metadata_text, "title_description"

    # --------------------------------------------------------
    # URL SLUG FALLBACK
    # --------------------------------------------------------

    try:
        parsed = urlparse(url)
        path = parsed.path.strip("/")

        if path:
            slug = path.split("/")[-1]

            # Remove common file extensions.
            slug = re.sub(
                r"\.(html?|php|aspx?)$",
                "",
                slug,
                flags=re.IGNORECASE
            )

            # Remove trailing numeric article IDs.
            slug = re.sub(
                r"-\d+$",
                "",
                slug
            )

            # Convert URL separators to readable spaces.
            slug = slug.replace("-", " ")
            slug = slug.replace("_", " ")

            # Remove repeated whitespace.
            slug = re.sub(
                r"\s+",
                " ",
                slug
            ).strip()

            if len(clean_text(slug)) >= MIN_TEXT_LENGTH:
                return slug, "url_slug"

    except Exception as e:
        print("URL fallback error:", repr(e))

    return metadata_text, "none"


# ============================================================
# CONFIDENCE + RISK SCORE
# ============================================================

def calculate_risk_score(prediction, confidence):
    """
    Calculate misinformation risk from 0 to 100.

    FAKE + high confidence  -> high risk
    REAL + high confidence  -> low risk
    Uncertain result         -> medium risk
    """
    try:
        confidence = float(confidence)
    except (TypeError, ValueError):
        confidence = 0.0

    confidence = max(0.0, min(100.0, confidence))
    prediction = str(prediction or "").upper()

    if prediction == "FAKE":
        risk_score = confidence
    elif prediction == "REAL":
        risk_score = 100.0 - confidence
    else:
        risk_score = 50.0

    return round(risk_score, 2)


def get_risk_level(risk_score):
    """Convert numeric risk into a simple user-facing level."""
    try:
        score = float(risk_score)
    except (TypeError, ValueError):
        score = 50.0

    if score >= 70:
        return "high"
    if score >= 40:
        return "medium"
    return "low"


# ============================================================
# ML PREDICTION
# ============================================================

def predict_text(text):
    if model is None or vectorizer is None:
        raise RuntimeError(
            "Model or vectorizer is not loaded."
        )

    cleaned = clean_text(text)

    if len(cleaned) < MIN_TEXT_LENGTH:
        raise ValueError(
            f"Please provide at least {MIN_TEXT_LENGTH} "
            "characters of meaningful text."
        )

    X = vectorizer.transform([cleaned])

    raw_prediction = int(model.predict(X)[0])

    # IMPORTANT:
    # trainmodel.py uses:
    # 0 = FAKE
    # 1 = REAL

    if raw_prediction == 0:
        prediction = "FAKE"
    else:
        prediction = "REAL"

    confidence = None

    try:
        probabilities = model.predict_proba(X)[0]

        class_probabilities = {
            int(cls): float(prob)
            for cls, prob in zip(
                model.classes_,
                probabilities
            )
        }

        confidence = round(
            class_probabilities.get(
                raw_prediction,
                max(probabilities)
            ) * 100,
            2
        )

    except Exception:
        confidence = None

    # --------------------------------------------------------
    # TOP CONTRIBUTING WORDS
    # --------------------------------------------------------

    top_words = []

    try:
        if len(COEFFICIENTS) == len(FEATURE_NAMES):

            row = X.toarray()[0]

            contributions = []

            for index, value in enumerate(row):

                if value == 0:
                    continue

                contribution = value * COEFFICIENTS[index]

                contributions.append(
                    (
                        abs(contribution),
                        contribution,
                        FEATURE_NAMES[index]
                    )
                )

            contributions.sort(
                key=lambda x: x[0],
                reverse=True
            )

            for _, contribution, word in contributions[:8]:

                direction = (
                    "REAL"
                    if contribution > 0
                    else "FAKE"
                )

                top_words.append({
                    "word": word,
                    "direction": direction
                })

    except Exception as e:
        print("Top words error:", e)

    # --------------------------------------------------------
    # RESULT TIER
    # --------------------------------------------------------

    if confidence is not None and confidence < CONFIDENCE_THRESHOLD:

        tier = "needs_verification"
        tier_label = "Needs Verification"
        emoji = "🔎"

    elif prediction == "FAKE":

        tier = "misleading"
        tier_label = "Likely Fake"
        emoji = "⚠️"

    else:

        tier = "credible"
        tier_label = "Likely Real"
        emoji = "✓"

    risk_score = calculate_risk_score(
        prediction,
        confidence
    )

    return {
        "prediction": prediction,
        "confidence": confidence,
        "risk_score": risk_score,
        "risk_level": get_risk_level(risk_score),
        "top_words": top_words,
        "tier": tier,
        "tier_label": tier_label,
        "emoji": emoji
    }


# ============================================================
# GOOGLE NEWS LIVE VERIFICATION
# ============================================================

def search_google_news(query, max_results=8):

    results = []

    try:

        query = query.strip()

        if not query:
            return results

        encoded_query = quote_plus(query)

        rss_url = (
            "https://news.google.com/rss/search?"
            f"q={encoded_query}&hl=en-IN&gl=IN&ceid=IN:en"
        )

        response = requests.get(
            rss_url,
            headers={
                "User-Agent": "Mozilla/5.0"
            },
            timeout=REQUEST_TIMEOUT
        )

        response.raise_for_status()

        root = ET.fromstring(response.content)

        for item in root.findall(".//item")[:max_results]:

            title = item.findtext("title") or ""
            link = item.findtext("link") or ""
            pub_date = item.findtext("pubDate") or ""
            source = item.findtext("source") or ""

            results.append({
                "title": title,
                "link": link,
                "published": pub_date,
                "source": source
            })

    except Exception as e:
        print("Google News search error:", e)

    return results


def lexical_overlap(text_a, text_b):

    words_a = set(clean_text(text_a).split())
    words_b = set(clean_text(text_b).split())

    if not words_a or not words_b:
        return 0

    common = words_a.intersection(words_b)

    return len(common) / max(len(words_a), 1)


def verify_live(text, url=None, title=None):

    search_query = ""

    if title:
        search_query = title.strip()

    if not search_query:
        words = clean_text(text).split()
        search_query = " ".join(words[:35])

    if not search_query:
        return {
            "status": "insufficient_evidence",
            "label": "Insufficient Evidence",
            "summary": "No useful search query could be created.",
            "results": []
        }

    news_results = search_google_news(
        search_query,
        max_results=8
    )

    relevant_results = []

    for item in news_results:

        combined = (
            item.get("title", "")
            + " "
            + item.get("source", "")
        )

        relevance = lexical_overlap(
            text,
            combined
        )

        if title:
            title_relevance = lexical_overlap(
                title,
                item.get("title", "")
            )

            relevance = max(
                relevance,
                title_relevance
            )

        item["relevance"] = round(
            relevance,
            3
        )

        if relevance >= 0.12:
            relevant_results.append(item)

    relevant_results.sort(
        key=lambda x: x["relevance"],
        reverse=True
    )

    if len(relevant_results) >= 3:

        status = "supporting_evidence"
        label = "Supporting Evidence"
        summary = (
            "Multiple current news results were found "
            "with similar information."
        )

    elif len(relevant_results) >= 1:

        status = "limited_evidence"
        label = "Limited Evidence"
        summary = (
            "Some related current news coverage was found, "
            "but the evidence is limited."
        )

    else:

        status = "insufficient_evidence"
        label = "Insufficient Evidence"
        summary = (
            "No sufficiently similar current news coverage "
            "was found."
        )

    return {
        "status": status,
        "label": label,
        "summary": summary,
        "results": relevant_results[:5]
    }



# ============================================================
# VERDICT COMBINATION LAYER
# ============================================================
# The ML model on its own only recognises the writing style of the
# dataset it was trained on, so a genuine article written in an
# unfamiliar style can still come back as FAKE.
#
# This layer keeps the model's opinion but adjusts the final verdict
# using two independent checks:
#
#   1. Live coverage  - do current news results report the same story?
#   2. Source         - did the link come from a recognised outlet?
#
# Every adjustment is recorded in "verdict_reasons" so the result can
# be explained to the user instead of being a black box.

EVIDENCE_ADJUSTMENT = {
    "supporting_evidence": -35,
    "limited_evidence": -15,
    "insufficient_evidence": 10,
}

KNOWN_OUTLET_ADJUSTMENT = -15

# Applied only for domains NOT on the fixed list, based on the LLM's
# reputation check instead.
LLM_REPUTABLE_ADJUSTMENT = -10
LLM_QUESTIONABLE_ADJUSTMENT = 12

FAKE_THRESHOLD = 70
REAL_THRESHOLD = 40


def format_percentage(value):
    try:
        return "{:.1f}%".format(float(value))
    except (TypeError, ValueError):
        return "unknown"


def format_signed(value):
    value = int(round(value))

    if value > 0:
        return "+{}".format(value)

    return str(value)


def apply_verification_layer(
    prediction_result,
    live_result=None,
    source_info=None
):
    """
    Combine the ML prediction with live evidence and source reputation.

    The raw model output is preserved under the ml_* keys so the UI can
    show both "what the model said" and "what TruthLens concluded".
    """

    result = dict(prediction_result or {})

    ml_prediction = str(result.get("prediction") or "").upper()
    ml_confidence = result.get("confidence")
    ml_risk = result.get("risk_score")

    # Keep the untouched model output for transparency.
    result["ml_prediction"] = ml_prediction
    result["ml_confidence"] = ml_confidence
    result["ml_risk_score"] = ml_risk
    result["ml_tier"] = result.get("tier")
    result["ml_tier_label"] = result.get("tier_label")

    live_result = live_result or {}
    status = live_result.get("status") or "insufficient_evidence"
    matches = live_result.get("results") or []
    match_count = len(matches)

    result["evidence_status"] = status
    result["evidence_count"] = match_count

    # The model had no usable opinion, so there is nothing to adjust.
    if ml_prediction not in ("FAKE", "REAL"):

        result["verdict_adjusted"] = False
        result["verdict_reasons"] = [
            "There was not enough usable text for the model "
            "to form an opinion."
        ]

        return result

    try:
        risk = float(ml_risk)
    except (TypeError, ValueError):
        risk = 50.0

    reasons = []

    if ml_prediction == "FAKE":
        reasons.append(
            "The model read the writing style as fake ({} confidence), "
            "so the starting risk is {}/100.".format(
                format_percentage(ml_confidence),
                round(risk, 2)
            )
        )
    else:
        reasons.append(
            "The model read the writing style as real ({} confidence), "
            "so the starting risk is {}/100.".format(
                format_percentage(ml_confidence),
                round(risk, 2)
            )
        )

    # --------------------------------------------------------
    # Check 1: live news coverage
    # --------------------------------------------------------

    adjustment = EVIDENCE_ADJUSTMENT.get(status, 0)
    risk += adjustment

    if status == "supporting_evidence":

        reasons.append(
            "{} current news results report the same story ({}).".format(
                match_count,
                format_signed(adjustment)
            )
        )

    elif status == "limited_evidence":

        reasons.append(
            "Only {} related news result(s) were found, which is "
            "limited support ({}).".format(
                match_count,
                format_signed(adjustment)
            )
        )

    else:

        reasons.append(
            "No matching current news coverage was found ({}).".format(
                format_signed(adjustment)
            )
        )

    # --------------------------------------------------------
    # Check 2: source reputation
    # --------------------------------------------------------

    domain = (source_info or {}).get("domain")

    if source_info and source_info.get("is_known_outlet"):

        risk += KNOWN_OUTLET_ADJUSTMENT

        reasons.append(
            "{} is a recognised news outlet ({}).".format(
                domain,
                format_signed(KNOWN_OUTLET_ADJUSTMENT)
            )
        )

    elif source_info and source_info.get("llm_checked"):

        llm_verdict = source_info.get("llm_verdict")

        if llm_verdict == "reputable_news":

            risk += LLM_REPUTABLE_ADJUSTMENT

            reasons.append(
                "{} isn't on the fixed outlet list, but an AI "
                "reputation check flagged it as likely reputable "
                "({}).".format(
                    domain,
                    format_signed(LLM_REPUTABLE_ADJUSTMENT)
                )
            )

        elif llm_verdict == "questionable":

            risk += LLM_QUESTIONABLE_ADJUSTMENT

            reasons.append(
                "{} isn't on the fixed outlet list, and an AI "
                "reputation check flagged it as questionable "
                "({}).".format(
                    domain,
                    format_signed(LLM_QUESTIONABLE_ADJUSTMENT)
                )
            )

        else:

            reasons.append(
                "{} isn't on the fixed outlet list; the AI "
                "reputation check was inconclusive (no change).".format(
                    domain
                )
            )

    elif domain:

        reasons.append(
            "{} is not on the recognised outlet list "
            "(no change).".format(domain)
        )

    # --------------------------------------------------------
    # Final verdict
    # --------------------------------------------------------

    risk = round(max(0.0, min(100.0, risk)), 2)

    if risk >= FAKE_THRESHOLD:
        verdict = "FAKE"
        tier = "misleading"
        tier_label = "Likely Fake"
        emoji = "\u26a0\ufe0f"

    elif risk >= REAL_THRESHOLD:
        verdict = "UNVERIFIED"
        tier = "needs_verification"
        tier_label = "Needs Verification"
        emoji = "\U0001f50e"

    else:
        verdict = "REAL"
        tier = "credible"
        tier_label = "Likely Real"
        emoji = "\u2713"

    if verdict != ml_prediction:

        reasons.append(
            "Combined risk is {}/100, so the model's {} result was "
            "changed to {}.".format(
                risk,
                ml_prediction,
                tier_label
            )
        )

    else:

        reasons.append(
            "Combined risk is {}/100, which agrees with "
            "the model.".format(risk)
        )

    result["prediction"] = verdict
    result["risk_score"] = risk
    result["risk_level"] = get_risk_level(risk)
    result["tier"] = tier
    result["tier_label"] = tier_label
    result["emoji"] = emoji
    result["verdict_adjusted"] = verdict != ml_prediction
    result["verdict_reasons"] = reasons

    return result


# ============================================================
# TEXT / URL PREDICTION
# ============================================================

@app.route("/predict", methods=["POST"])
def predict():

    try:

        data = request.get_json(
            silent=True
        )

        if not data:
            return jsonify({
                "error": "No JSON data was received."
            }), 400

        user_text = str(
            data.get("text", "")
        ).strip()

        if not user_text:
            return jsonify({
                "error": "Please enter some news text or a URL."
            }), 400

        # ====================================================
        # URL INPUT
        # ====================================================

        if is_url(user_text):

            url = normalize_url(user_text)

            print(
                "Processing URL:",
                url
            )

            # -----------------------------------------------
            # URL SAFETY
            # -----------------------------------------------

            if not is_safe_public_url(url):

                return jsonify({
                    "prediction": "UNVERIFIED",
                    "confidence": 0,
                    "risk_score": 50,
                    "risk_level": "medium",
                    "top_words": [],
                    "tier": "needs_verification",
                    "tier_label": "Needs Verification",
                    "emoji": "🔎",
                    "url": url,
                    "extracted_text": "",
                    "title": "",
                    "description": "",
                    "source_info": get_domain_info(url),
                    "article_text_available": False,
                    "checked_live": False,
                    "message": (
                        "This URL could not be safely accessed. "
                        "Please try another public webpage."
                    )
                }), 200

            source_info = get_domain_info(url)

            # -----------------------------------------------
            # EXTRACT ARTICLE
            # -----------------------------------------------

            article_data = fetch_article_text(url)

            article_text = (
                article_data.get(
                    "article_text",
                    ""
                ) or ""
            ).strip()

            title = (
                article_data.get(
                    "title",
                    ""
                ) or ""
            ).strip()

            description = (
                article_data.get(
                    "description",
                    ""
                ) or ""
            ).strip()

            extraction_error = article_data.get(
                "error"
            )

            # -----------------------------------------------
            # FALLBACK ANALYSIS TEXT
            # -----------------------------------------------

            # Use full article text first.
            if len(clean_text(article_text)) >= MIN_TEXT_LENGTH:

                analysis_text = article_text
                analysis_basis = "article_text"
                metadata_used = False

            else:

                # If full article extraction failed, use:
                # title + description, then URL slug.
                fallback_text, fallback_basis = (
                    build_url_fallback_text(
                        url,
                        title=title,
                        description=description
                    )
                )

                analysis_text = fallback_text
                analysis_basis = fallback_basis
                metadata_used = bool(analysis_text)

            print(
                "URL analysis basis:",
                analysis_basis,
                "| text length:",
                len(analysis_text)
            )

            # -----------------------------------------------
            # LIVE VERIFICATION
            # -----------------------------------------------

            live_result = verify_live(
                analysis_text or title or description,
                url=url,
                title=title
            )

            # -----------------------------------------------
            # NO CONTENT AVAILABLE
            # -----------------------------------------------

            if not analysis_text:

                return jsonify({
                    "prediction": "UNVERIFIED",
                    "confidence": 0,
                    "risk_score": 50,
                    "risk_level": "medium",
                    "top_words": [],
                    "tier": "needs_verification",
                    "tier_label": "Needs Verification",
                    "emoji": "🔎",

                    "url": url,

                    "extracted_text": analysis_text,
                    "title": title,
                    "description": description,

                    "source_info": source_info,

                    "article_text_available": False,
                    "metadata_used": False,
                    "analysis_basis": analysis_basis,

                    "extraction_error": extraction_error,

                    "live_verification": live_result,
                    "checked_live": True,

                    "message": (
                        "The webpage did not expose enough "
                        "readable article text or metadata for "
                        "ML analysis. The result is marked "
                        "as UNVERIFIED."
                    )
                }), 200

            # -----------------------------------------------
            # ML PREDICTION
            # -----------------------------------------------

            prediction_result = predict_text(
                analysis_text
            )

            # Combine the model's opinion with the live evidence
            # check and the source reputation check.
            prediction_result = apply_verification_layer(
                prediction_result,
                live_result,
                source_info
            )

            response = {
                **prediction_result,

                "url": url,

                "extracted_text": analysis_text,
                "title": title,
                "description": description,

                "source_info": source_info,

                "article_text_available": not metadata_used,
                "metadata_used": metadata_used,
                "analysis_basis": analysis_basis,

                "extraction_error": extraction_error,

                "live_verification": live_result,
                "checked_live": True
            }

            if metadata_used:

                if analysis_basis == "title_description":

                    response["message"] = (
                        "The page did not expose the full article text, "
                        "so the title/description were used for analysis. "
                        "Treat this result as lower-confidence evidence."
                    )

                elif analysis_basis == "url_slug":

                    response["message"] = (
                        "The page did not expose readable article text "
                        "or usable metadata, so the URL headline was used "
                        "as a limited fallback. Treat this result as "
                        "lower-confidence evidence."
                    )

                else:

                    response["message"] = (
                        "Only limited webpage information was available "
                        "for analysis. Treat this result as "
                        "lower-confidence evidence."
                    )

            else:

                response["message"] = (
                    "The article text was extracted and analyzed "
                    "using the trained ML model."
                )

            return jsonify(response), 200

        # ====================================================
        # NORMAL TEXT INPUT
        # ====================================================

        if len(clean_text(user_text)) < MIN_TEXT_LENGTH:

            return jsonify({
                "error": (
                    f"Please enter at least "
                    f"{MIN_TEXT_LENGTH} characters "
                    "of meaningful news text."
                )
            }), 400

        prediction_result = predict_text(
            user_text
        )

        live_result = verify_live(
            user_text
        )

        # No URL was given, so only the live evidence check applies.
        prediction_result = apply_verification_layer(
            prediction_result,
            live_result,
            None
        )

        response = {
            **prediction_result,

            "extracted_text": user_text,

            "source_info": None,

            "article_text_available": True,

            "live_verification": live_result,
            "checked_live": True
        }

        return jsonify(response), 200

    except ValueError as e:

        return jsonify({
            "error": str(e)
        }), 400

    except Exception as e:

        print(
            "Prediction error:",
            repr(e)
        )

        return jsonify({
            "error": (
                "An unexpected server error occurred."
            ),
            "details": str(e)
        }), 500


# ============================================================
# IMAGE PREDICTION / OCR
# ============================================================

@app.route("/predict-image", methods=["POST"])
def predict_image():

    try:

        if "image" not in request.files:

            return jsonify({
                "error": "No image was uploaded."
            }), 400

        file = request.files["image"]

        if not file.filename:

            return jsonify({
                "error": "Please select an image."
            }), 400

        image_bytes = file.read()

        if not image_bytes:

            return jsonify({
                "error": "The uploaded image is empty."
            }), 400

        image = Image.open(
            io.BytesIO(image_bytes)
        )

        # Convert to RGB for reliable OCR
        if image.mode not in (
            "RGB",
            "L"
        ):
            image = image.convert("RGB")

        extracted_text = pytesseract.image_to_string(
            image
        ).strip()

        # Remove browser-chrome noise (tabs, address bar, nav menus,
        # subscribe banners) before this text is analyzed, so a
        # screenshot of a full browser window doesn't get misjudged
        # because of junk mixed in with the real article.
        analysis_text = strip_ocr_chrome_noise(extracted_text)

        if len(clean_text(analysis_text)) < MIN_TEXT_LENGTH:

            return jsonify({
                "prediction": "UNVERIFIED",
                "confidence": 0,
                "risk_score": 50,
                "risk_level": "medium",
                "top_words": [],

                "tier": "needs_verification",
                "tier_label": "Needs Verification",
                "emoji": "🔎",

                "extracted_text": extracted_text,

                "article_text_available": False,

                "live_verification": {
                    "status": "insufficient_evidence",
                    "label": "Insufficient Evidence",
                    "summary": (
                        "Not enough readable article text was "
                        "found in the image."
                    ),
                    "results": []
                },

                "checked_live": False,

                "message": (
                    "Not enough readable article text was found in "
                    "this image after filtering out browser tabs, "
                    "menus, and other on-screen clutter. Try a "
                    "screenshot cropped to just the headline and "
                    "article text."
                )
            }), 200

        prediction_result = predict_text(
            analysis_text
        )

        live_result = verify_live(
            analysis_text
        )

        prediction_result = apply_verification_layer(
            prediction_result,
            live_result,
            None
        )

        return jsonify({
            **prediction_result,

            "extracted_text": extracted_text,
            "analyzed_text": analysis_text,

            "article_text_available": True,

            "live_verification": live_result,
            "checked_live": True
        }), 200

    except Exception as e:

        print(
            "Image prediction error:",
            repr(e)
        )

        return jsonify({
            "error": (
                "Unable to process the image."
            ),
            "details": str(e)
        }), 500


# ============================================================
# FRONTEND SERVING
# ============================================================

@app.route("/", methods=["GET"])
def serve_frontend_index():
    """
    Serve the frontend through Flask so browser scripts load over
     instead of file:///.
    """
    index_path = os.path.join(FRONTEND_DIR, "Index.html")

    if os.path.exists(index_path):
        return send_from_directory(
            FRONTEND_DIR,
            "Index.html"
        )

    detector_path = os.path.join(
        FRONTEND_DIR,
        "detector.html"
    )

    if os.path.exists(detector_path):
        return send_from_directory(
            FRONTEND_DIR,
            "detector.html"
        )

    return jsonify({
        "status": "ok",
        "message": "TruthLens backend is running."
    })


@app.route("/<path:filename>", methods=["GET"])
def serve_frontend_file(filename):
    """
    Serve frontend HTML, CSS, JavaScript and other public assets.
    API routes above remain handled by their specific endpoints.
    """

    requested_path = os.path.abspath(
        os.path.join(FRONTEND_DIR, filename)
    )

    # Prevent path traversal outside the frontend directory.
    if not requested_path.startswith(
        os.path.abspath(FRONTEND_DIR) + os.sep
    ):
        return jsonify({
            "error": "Invalid frontend path."
        }), 400

    if os.path.isfile(requested_path):
        return send_from_directory(
            FRONTEND_DIR,
            filename
        )

    return jsonify({
        "error": "Frontend file not found."
    }), 404


# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":
    print("=" * 60)
    print("TruthLens backend starting...")
    print("=" * 60)

    print(
        "Model loaded:",
        model is not None
    )

    print(
        "Vectorizer loaded:",
        vectorizer is not None
    )

    print(
        "Model directory:",
        MODEL_DIR
    )

    print(
        "Server:",
        ""
    )

    print("=" * 60)

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )