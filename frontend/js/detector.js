/* =========================================================
   TRUTHLENS — DETECTOR
   ---------------------------------------------------------
   Handles text, URL and image verification.

   STEP 1 FEATURE:
   - Why this result?
   - Potential red flags
   - What should I check?

   The explanation cards are created automatically, so
   detector.html does not need new markup.
   ========================================================= */

import { saveHistoryEntry } from "./history.js";

const API_BASE_URL = "";

const PREDICT_URL = `${API_BASE_URL}/predict`;
const IMAGE_PREDICT_URL = `${API_BASE_URL}/predict-image`;

const MIN_INPUT_LENGTH = 25;

/* =========================================================
   SMALL DOM HELPERS
   ========================================================= */

function el(id) {
    return document.getElementById(id);
}

function show(node) {
    if (!node) return;

    node.classList.remove("hidden");
    node.hidden = false;

    /* Set display explicitly in case style.css has display:none. */
    node.style.display = "block";
}

function hide(node) {
    if (!node) return;

    node.classList.add("hidden");
    node.hidden = true;
    node.style.display = "none";
}

function setText(node, value) {
    if (node) node.textContent = value;
}

/* =========================================================
   VERDICT COLOURS
   ========================================================= */

const VERDICT_COLOURS = {
    REAL: "#15803d",
    FAKE: "#b42318",
    UNVERIFIED: "#b45309",
    UNKNOWN: "#6b7280"
};

function verdictColour(verdict) {
    return VERDICT_COLOURS[verdict] || VERDICT_COLOURS.UNKNOWN;
}

function riskColour(riskScore) {
    if (riskScore >= 70) return "#b42318";
    if (riskScore >= 40) return "#b45309";
    return "#15803d";
}

/* =========================================================
   INIT
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    const checkBtn = el("checkBtn");
    const checkImageBtn = el("checkImageBtn");
    const articleInput = el("articleInput");

    if (checkBtn) {
        checkBtn.addEventListener("click", (event) => {
            event.preventDefault();
            handleAnalyzeClick();
        });
    }

    if (checkImageBtn) {
        checkImageBtn.addEventListener("click", (event) => {
            event.preventDefault();
            handleImageVerification(event);
        });
    }

    if (articleInput) {
        articleInput.addEventListener("input", updateCharacterCount);
    }

    setupImageUpload();
    updateCharacterCount();
});

/* The mode buttons are handled by the inline script in
   detector.html, which exposes the selected mode here. */
function currentMode() {
    try {
        if (typeof window.truthLensVerificationMode === "function") {
            return window.truthLensVerificationMode();
        }
    } catch (error) {
        console.warn("Mode lookup failed:", error);
    }

    return "text";
}

/* =========================================================
   ANALYZE BUTTON
   ========================================================= */

async function handleAnalyzeClick() {
    const input = el("articleInput");

    if (!input) return;

    const value = input.value.trim();

    if (!value) {
        showError("Enter a news headline, article text, or a link.");
        return;
    }

    if (isValidURL(value) || currentMode() === "url") {
        await handleURLVerification(value);
        return;
    }

    await handleTextVerification(value);
}

/* =========================================================
   TEXT VERIFICATION
   ========================================================= */

async function handleTextVerification(text) {
    const value = String(text || "").trim();

    if (value.length < MIN_INPUT_LENGTH) {
        showError(
            `Add at least ${MIN_INPUT_LENGTH} characters. ` +
            "A headline plus a few lines of the article works best."
        );
        return;
    }

    await runAnalysis(
        PREDICT_URL,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                text: value
            })
        },
        value,
        "text"
    );
}

/* =========================================================
   URL VERIFICATION
   ========================================================= */

async function handleURLVerification(url) {
    const value = String(url || "").trim();

    if (!value) {
        showError(
            "Paste a complete link starting with http:// or https://"
        );
        return;
    }

    if (!isValidURL(value)) {
        showError(
            "That link is not valid. Use a full URL starting with https://"
        );
        return;
    }

    await runAnalysis(
        PREDICT_URL,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                text: value,
                url: value
            })
        },
        value,
        "url"
    );
}

/* =========================================================
   SHARED REQUEST RUNNER
   ========================================================= */

async function runAnalysis(endpoint, options, input, mode) {
    clearError();
    showLoading(true);

    try {
        const response = await fetch(endpoint, options);
        const data = await parseJSONResponse(response);

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                "The analysis could not be completed."
            );
        }

        displayResult(data, input, mode);

        await saveResultToHistory(
            data,
            input,
            mode
        );

    } catch (error) {
        console.error("Analysis failed:", error);
        showError(describeNetworkError(error));

    } finally {
        showLoading(false);
    }
}

function describeNetworkError(error) {
    if (
        error instanceof TypeError &&
        /fetch|network/i.test(error.message || "")
    ) {
        return (
            "The TruthLens backend is not responding. " +
            "Start App.py and check that it is running on port 5000."
        );
    }

    return (
        error.message ||
        "Something went wrong during the analysis."
    );
}

/* =========================================================
   IMAGE VERIFICATION
   ========================================================= */

function setupImageUpload() {
    const imageInput = el("imageInput");

    if (!imageInput) return;

    imageInput.addEventListener("change", () => {
        const file =
            imageInput.files &&
            imageInput.files[0];

        if (!file) return;

        const label = el("fileName");

        if (label) {
            label.textContent = file.name;
        }
    });
}

async function handleImageVerification(event) {
    if (
        event &&
        typeof event.preventDefault === "function"
    ) {
        event.preventDefault();
    }

    const imageInput = el("imageInput");

    if (!imageInput) {
        showError(
            "The image upload control is missing from this page."
        );
        return;
    }

    if (
        !imageInput.files ||
        imageInput.files.length === 0
    ) {
        showError("Choose a screenshot first.");
        return;
    }

    const file = imageInput.files[0];

    if (
        !file.type ||
        !file.type.startsWith("image/")
    ) {
        showError(
            "That file is not an image. Choose a PNG or JPG screenshot."
        );
        return;
    }

    if (file.size === 0) {
        showError(
            "That image file is empty. Choose another screenshot."
        );
        return;
    }

    /*
       The backend reads request.files["image"].
       Append it once — appending twice doubles the upload.
    */
    const formData = new FormData();

    formData.append(
        "image",
        file,
        file.name
    );

    clearError();
    showLoading(true);

    try {
        const response = await fetch(
            IMAGE_PREDICT_URL,
            {
                method: "POST",
                body: formData
            }
        );

        const data =
            await parseJSONResponse(response);

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                "The screenshot could not be analyzed."
            );
        }

        const extractedText =
            data.extracted_text ||
            data.ocr_text ||
            data.text ||
            "";

        if (!String(extractedText).trim()) {
            throw new Error(
                "No readable text was found in this screenshot. " +
                "Crop it to just the headline and article text and try again."
            );
        }

        displayResult(
            data,
            extractedText,
            "image"
        );

        await saveResultToHistory(
            data,
            extractedText,
            "image"
        );

    } catch (error) {
        console.error(
            "Screenshot analysis failed:",
            error
        );

        showError(
            describeNetworkError(error)
        );

    } finally {
        showLoading(false);
    }
}

/* =========================================================
   RESULT DISPLAY
   ---------------------------------------------------------
   Fills the existing result elements and creates the new
   explanation section automatically.
   ========================================================= */

function displayResult(
    data,
    input,
    mode = "text"
) {
    const resultBox = el("resultBox");

    if (!resultBox) {
        console.error(
            "resultBox is missing from detector.html."
        );
        return;
    }

    clearError();

    const verdict =
        normalizePrediction(
            data.prediction ??
            data.final_verdict ??
            data.label ??
            data.result ??
            ""
        );

    const modelVerdict =
        normalizePrediction(
            data.ml_prediction ??
            data.prediction ??
            ""
        );

    const confidence =
        Number(
            data.confidence ??
            data.ml_confidence ??
            data.confidence_score ??
            0
        );

    const riskScore =
        Number(
            data.risk_score ??
            calculateRiskScore(
                verdict,
                confidence
            )
        );

    const riskLevel =
        data.risk_level ||
        getRiskLevel(riskScore);

    /*
       The hidden class has to be removed, not just
       the display style.
    */
    show(resultBox);

    renderVerdict(
        resultBox,
        data,
        verdict,
        modelVerdict,
        confidence
    );

    renderMetrics(
        confidence,
        riskScore,
        riskLevel
    );

    /*
       NEW STEP 1 FEATURE
    */
    renderExplanation(
        resultBox,
        data,
        verdict,
        modelVerdict,
        confidence,
        riskScore,
        mode
    );

    renderExtractedText(
        data,
        mode
    );

    renderSourceInfo(data);

    renderLiveVerification(data);

    renderEvidence(data);

    renderContributingWords(data);

    resultBox.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

/* =========================================================
   STEP 1 — EXPLANATION
   ========================================================= */

function renderExplanation(
    resultBox,
    data,
    verdict,
    modelVerdict,
    confidence,
    riskScore,
    mode
) {
    /*
       Remove an old explanation section first.
       This prevents duplicate cards if the user runs
       multiple checks on the same page.
    */
    const oldSection =
        document.getElementById(
            "truthLensExplanation"
        );

    if (oldSection) {
        oldSection.remove();
    }

    /*
       Find the existing result details area.

       Your detector.html already has:
       .tl-result-details

       If it isn't available, fall back to resultBox.
    */
    const details =
        resultBox.querySelector(
            ".tl-result-details"
        ) || resultBox;

    /*
       Create main wrapper.
    */
    const wrapper =
        document.createElement("div");

    wrapper.id =
        "truthLensExplanation";

    wrapper.className =
        "tl-result-details";

    wrapper.style.marginTop =
        "18px";

    /*
       Create cards.
    */
    const whyCard =
        createExplanationCard(
            "🧠",
            "Why this result?",
            "whyResultContent"
        );

    const redFlagsCard =
        createExplanationCard(
            "🚩",
            "Potential red flags",
            "redFlagsContent"
        );

    const tipsCard =
        createExplanationCard(
            "💡",
            "What should I check?",
            "checkTipsContent"
        );

    wrapper.appendChild(
        whyCard
    );

    wrapper.appendChild(
        redFlagsCard
    );

    wrapper.appendChild(
        tipsCard
    );

    /*
       Put explanation cards before the existing
       detailed evidence cards.
    */
    details.parentNode.insertBefore(
        wrapper,
        details
    );

    /*
       Fill the cards.
    */
    renderWhyResult(
        document.getElementById(
            "whyResultContent"
        ),
        data,
        verdict,
        modelVerdict,
        confidence,
        riskScore,
        mode
    );

    renderRedFlags(
        document.getElementById(
            "redFlagsContent"
        ),
        data,
        verdict,
        modelVerdict,
        riskScore
    );

    renderCheckTips(
        document.getElementById(
            "checkTipsContent"
        ),
        data,
        verdict,
        mode
    );
}

function createExplanationCard(
    icon,
    title,
    contentId
) {
    const card =
        document.createElement("div");

    card.className =
        "tl-result-card";

    card.style.padding =
        "18px";

    const heading =
        document.createElement("h3");

    heading.style.fontSize =
        "0.95rem";

    heading.style.marginBottom =
        "10px";

    heading.textContent =
        `${icon} ${title}`;

    const content =
        document.createElement("div");

    content.id =
        contentId;

    content.style.fontSize =
        "0.78rem";

    content.style.lineHeight =
        "1.6";

    card.appendChild(
        heading
    );

    card.appendChild(
        content
    );

    return card;
}

/* =========================================================
   WHY THIS RESULT?
   ========================================================= */

function renderWhyResult(
    container,
    data,
    verdict,
    modelVerdict,
    confidence,
    riskScore,
    mode
) {
    if (!container) return;

    const reasons =
        Array.isArray(
            data.verdict_reasons
        )
            ? data.verdict_reasons
            : [];

    const live =
        data.live_verification;

    const source =
        data.source_info;

    const parts = [];

    /*
       1. Explain the model reading.
    */
    if (
        modelVerdict &&
        modelVerdict !== "UNKNOWN"
    ) {
        parts.push(
            `The machine-learning model classified the content as ${verdictWord(modelVerdict)} with ${formatPercent(confidence)} confidence.`
        );
    }

    /*
       2. Explain the evidence check.
    */
    if (
        live &&
        typeof live === "object"
    ) {
        if (
            live.label
        ) {
            parts.push(
                `The live evidence check returned "${String(live.label)}".`
            );
        }

        if (
            live.summary
        ) {
            parts.push(
                String(live.summary)
            );
        }
    }

    /*
       3. Explain source recognition.
    */
    if (
        source &&
        source.domain
    ) {
        if (
            source.is_known_outlet
        ) {
            parts.push(
                `The source domain ${source.domain} is recognised by the current TruthLens outlet list.`
            );
        } else {
            parts.push(
                `The source domain ${source.domain} is not on the current recognised outlet list.`
            );
        }
    }

    /*
       4. Explain final risk.
    */
    parts.push(
        `The final TruthLens risk score is ${formatScore(riskScore)}/100.`
    );

    /*
       5. Add backend reasons.
    */
    if (reasons.length) {
        reasons.forEach(
            (reason) => {
                const text =
                    String(reason || "").trim();

                if (
                    text &&
                    !parts.includes(text)
                ) {
                    parts.push(text);
                }
            }
        );
    }

    /*
       If backend gave us a message, include it.
    */
    if (
        data.message
    ) {
        const message =
            String(data.message).trim();

        if (
            message &&
            !parts.includes(message)
        ) {
            parts.push(message);
        }
    }

    /*
       Build list safely.
    */
    const list =
        document.createElement("ul");

    list.style.margin =
        "0";

    list.style.paddingLeft =
        "18px";

    parts
        .slice(0, 8)
        .forEach((part) => {
            const item =
                document.createElement("li");

            item.style.marginBottom =
                "7px";

            item.textContent =
                part;

            list.appendChild(
                item
            );
        });

    if (
        list.children.length
    ) {
        container.appendChild(
            list
        );
    } else {
        const empty =
            document.createElement("p");

        empty.className =
            "tl-empty";

        empty.textContent =
            "TruthLens does not have enough explanation data for this result.";

        container.appendChild(
            empty
        );
    }
}

/* =========================================================
   POTENTIAL RED FLAGS
   ---------------------------------------------------------
   These are signals to investigate.
   They are NOT proof that something is false.
   ========================================================= */

function renderRedFlags(
    container,
    data,
    verdict,
    modelVerdict,
    riskScore
) {
    if (!container) return;

    const flags = [];

    const confidence =
        Number(
            data.confidence ??
            data.ml_confidence ??
            0
        );

    const live =
        data.live_verification;

    const source =
        data.source_info;

    const evidenceCount =
        Number(
            data.evidence_count ??
            (
                live &&
                Array.isArray(live.results)
                    ? live.results.length
                    : 0
            )
        );

    /*
       Red flag 1:
       High model risk.
    */
    if (
        riskScore >= 70
    ) {
        flags.push(
            "The final misinformation-risk score is high."
        );
    }

    /*
       Red flag 2:
       Medium risk.
    */
    else if (
        riskScore >= 40
    ) {
        flags.push(
            "The final misinformation-risk score is in the medium range, so additional checking is worthwhile."
        );
    }

    /*
       Red flag 3:
       Low confidence.
    */
    if (
        confidence > 0 &&
        confidence < 70
    ) {
        flags.push(
            "The model confidence is below 70%, so the classifier has limited confidence in its own prediction."
        );
    }

    /*
       Red flag 4:
       No supporting current coverage.
    */
    const evidenceStatus =
        String(
            data.evidence_status ||
            (live && live.status) ||
            ""
        ).toLowerCase();

    if (
        evidenceStatus.includes(
            "insufficient"
        ) ||
        evidenceCount === 0
    ) {
        flags.push(
            "TruthLens did not find enough closely matching current news coverage to support the story."
        );
    }

    /*
       Red flag 5:
       Limited evidence.
    */
    if (
        evidenceStatus.includes(
            "limited"
        )
    ) {
        flags.push(
            "Only limited matching news coverage was found, so the evidence check is not conclusive."
        );
    }

    /*
       Red flag 6:
       Unknown source.
    */
    if (
        source &&
        source.domain &&
        !source.is_known_outlet
    ) {
        flags.push(
            "The source is not on TruthLens's recognised outlet list. This is a signal to investigate the source, not proof that it is unreliable."
        );
    }

    /*
       Red flag 7:
       Final verdict is unverified.
    */
    if (
        verdict === "UNVERIFIED"
    ) {
        flags.push(
            "TruthLens could not reach a sufficiently strong final classification, so the story should be independently checked."
        );
    }

    /*
       Red flag 8:
       Model/evidence disagreement.
    */
    if (
        data.verdict_adjusted
    ) {
        flags.push(
            "The evidence check changed the model's original result, which means the two checks did not fully agree."
        );
    }

    /*
       If nothing triggered, show positive neutral message.
    */
    if (
        flags.length === 0
    ) {
        const empty =
            document.createElement("p");

        empty.className =
            "tl-empty";

        empty.textContent =
            "No major warning signals were triggered by the available checks. You should still verify important claims independently.";

        container.appendChild(
            empty
        );

        return;
    }

    const list =
        document.createElement("ul");

    list.style.margin =
        "0";

    list.style.paddingLeft =
        "18px";

    flags.forEach(
        (flag) => {
            const item =
                document.createElement("li");

            item.style.marginBottom =
                "7px";

            item.textContent =
                flag;

            list.appendChild(
                item
            );
        }
    );

    container.appendChild(
        list
    );

    /*
       Small clarification under the flags.
    */
    const note =
        document.createElement("p");

    note.style.marginTop =
        "12px";

    note.style.fontSize =
        "0.72rem";

    note.style.color =
        "#8a919d";

    note.textContent =
        "⚠️ A red flag is a reason to investigate further — it is not by itself proof that a claim is false.";

    container.appendChild(
        note
    );
}

/* =========================================================
   WHAT SHOULD I CHECK?
   ========================================================= */

function renderCheckTips(
    container,
    data,
    verdict,
    mode
) {
    if (!container) return;

    const tips = [];

    const live =
        data.live_verification;

    const source =
        data.source_info;

    const results =
        live &&
        Array.isArray(live.results)
            ? live.results
            : [];

    /*
       Always recommend primary-source checking.
    */
    tips.push(
        "Check whether the original claim appears on an official government, organisation, court, scientific, or other primary source when one exists."
    );

    /*
       Compare dates.
    */
    tips.push(
        "Check the publication date and make sure the article is not describing an old event as if it were recent."
    );

    /*
       Compare multiple sources.
    */
    if (
        results.length > 0
    ) {
        tips.push(
            "Open the matching news results and compare their dates, wording, and facts with the content you submitted."
        );
    } else {
        tips.push(
            "Search for the main claim using several independent news sources rather than relying on a single article."
        );
    }

    /*
       Source-specific advice.
    */
    if (
        source &&
        source.domain &&
        !source.is_known_outlet
    ) {
        tips.push(
            `Look into ${source.domain}: check its authorship, ownership, contact information, corrections policy, and track record before trusting the claim.`
        );
    }

    /*
       Model-specific advice.
    */
    tips.push(
        "Look at the exact claim itself. A writing-style classifier can identify patterns in text, but writing style alone cannot establish whether a real-world fact is true."
    );

    /*
       Screenshot-specific advice.
    */
    if (
        mode === "image"
    ) {
        tips.push(
            "Because this result came from OCR, compare the extracted text with the screenshot to make sure names, numbers, dates, and punctuation were read correctly."
        );
    }

    /*
       URL-specific advice.
    */
    if (
        mode === "url"
    ) {
        tips.push(
            "Open the original page and check the headline, author, date, article body, and cited sources rather than relying only on the URL."
        );
    }

    /*
       High-risk result.
    */
    const riskScore =
        Number(
            data.risk_score ?? 0
        );

    if (
        riskScore >= 70
    ) {
        tips.push(
            "Because the risk score is high, avoid sharing the claim as established fact until you have checked reliable independent sources."
        );
    }

    /*
       Unverified result.
    */
    if (
        verdict === "UNVERIFIED"
    ) {
        tips.push(
            "Treat this result as unresolved rather than automatically true or false."
        );
    }

    const list =
        document.createElement("ol");

    list.style.margin =
        "0";

    list.style.paddingLeft =
        "20px";

    tips
        .slice(0, 8)
        .forEach(
            (tip) => {
                const item =
                    document.createElement("li");

                item.style.marginBottom =
                    "7px";

                item.textContent =
                    tip;

                list.appendChild(
                    item
                );
            }
        );

    container.appendChild(
        list
    );
}

/* =========================================================
   VERDICT BLOCK
   ========================================================= */

function renderVerdict(
    resultBox,
    data,
    verdict,
    modelVerdict,
    confidence
) {
    const label =
        el("resultLabel");

    const subtitle =
        resultBox.querySelector(
            ".tl-verdict-subtitle"
        );

    const titleNote =
        resultBox.querySelector(
            ".tl-result-title span"
        );

    const tierLabel =
        data.tier_label ||
        verdictWord(verdict);

    if (label) {
        label.textContent =
            tierLabel;

        label.style.color =
            verdictColour(verdict);
    }

    if (titleNote) {
        titleNote.textContent =
            data.verdict_adjusted
                ? "Model + evidence check"
                : "Model check";
    }

    if (subtitle) {
        const parts = [];

        if (
            modelVerdict &&
            modelVerdict !== "UNKNOWN"
        ) {
            parts.push(
                `The model alone read this as ${verdictWord(modelVerdict)} at ${formatPercent(confidence)} confidence.`
            );
        }

        if (
            data.verdict_adjusted
        ) {
            parts.push(
                "The evidence check changed that result."
            );
        } else if (
            data.verdict_reasons
        ) {
            parts.push(
                "The evidence check agreed with it."
            );
        }

        if (
            data.message
        ) {
            parts.push(
                data.message
            );
        }

        subtitle.textContent =
            parts.join(" ");
    }
}

function verdictWord(verdict) {
    if (
        verdict === "REAL"
    ) {
        return "Likely Real";
    }

    if (
        verdict === "FAKE"
    ) {
        return "Likely Fake";
    }

    if (
        verdict === "UNVERIFIED"
    ) {
        return "Needs Verification";
    }

    return "No result";
}

/* =========================================================
   CONFIDENCE + RISK
   ========================================================= */

function renderMetrics(
    confidence,
    riskScore,
    riskLevel
) {
    const confidenceValue =
        el("confidence");

    const confidenceBar =
        el("confidenceBar");

    const confidenceNote =
        el("confidenceValue");

    const riskValue =
        el("riskScore");

    const riskBar =
        el("riskScoreBar");

    const riskLabel =
        el("riskLevel");

    setText(
        confidenceValue,
        formatPercent(confidence)
    );

    if (confidenceBar) {
        confidenceBar.style.width =
            `${clamp(
                confidence,
                0,
                100
            )}%`;

        confidenceBar.style.background =
            "#334155";
    }

    setText(
        confidenceNote,
        "How sure the model is about its own reading of the writing style."
    );

    setText(
        riskValue,
        `${formatScore(riskScore)}/100`
    );

    if (riskBar) {
        riskBar.style.width =
            `${clamp(
                riskScore,
                0,
                100
            )}%`;

        riskBar.style.background =
            riskColour(riskScore);
    }

    setText(
        riskLabel,
        `${capitalise(riskLevel)} risk`
    );
}

/* =========================================================
   EXTRACTED TEXT PREVIEW
   ========================================================= */

function renderExtractedText(
    data,
    mode
) {
    const container =
        el("extractedTextPreview");

    if (!container) return;

    const text =
        String(
            data.extracted_text ||
            data.analyzed_text ||
            ""
        ).trim();

    if (
        !text ||
        mode === "text"
    ) {
        hide(container);
        return;
    }

    const heading =
        mode === "image"
            ? "Text read from the screenshot"
            : "Text taken from the page";

    const preview =
        text.length > 700
            ? `${text.slice(0, 700)}…`
            : text;

    container.innerHTML = `
        <h3>${escapeHTML(heading)}</h3>
        <p style="white-space:pre-wrap">${escapeHTML(preview)}</p>
    `;

    show(container);
}

/* =========================================================
   SOURCE INFO
   ========================================================= */

function renderSourceInfo(data) {
    const container =
        el("sourceInfo");

    if (!container) return;

    const source =
        data.source_info;

    if (
        !source ||
        !source.domain
    ) {
        hide(container);
        return;
    }

    const known =
        Boolean(
            source.is_known_outlet
        );

    container.innerHTML = `
        <h3>Source</h3>

        <p>
            <strong>
                ${escapeHTML(source.domain)}
            </strong>
        </p>

        <p>
            ${
                known
                    ? "This domain is on the recognised news outlet list, which lowers the risk score."
                    : "This domain is not on the recognised news outlet list, so it does not change the risk score."
            }
        </p>
    `;

    show(container);
}

/* =========================================================
   LIVE VERIFICATION + REASONING
   ========================================================= */

function renderLiveVerification(data) {
    const container =
        el("liveVerification");

    if (!container) return;

    const live =
        data.live_verification;

    const reasons =
        Array.isArray(
            data.verdict_reasons
        )
            ? data.verdict_reasons
            : [];

    if (
        !live &&
        !reasons.length
    ) {
        hide(container);
        return;
    }

    let html =
        "<h3>Evidence check</h3>";

    if (
        live &&
        typeof live === "object"
    ) {
        html += `
            <div class="tl-live-badge">
                ${escapeHTML(
                    live.label ||
                    "Checked"
                )}
            </div>

            <p>
                ${escapeHTML(
                    live.summary ||
                    ""
                )}
            </p>
        `;
    }

    if (
        reasons.length
    ) {
        html += `
            <p style="margin-top:12px">
                <strong>
                    How this verdict was reached
                </strong>
            </p>

            <ol style="margin:6px 0 0;padding-left:18px">
                ${reasons
                    .map(
                        (reason) =>
                            `
                            <li style="margin:4px 0;font-size:.78rem;line-height:1.5">
                                ${escapeHTML(
                                    reason
                                )}
                            </li>
                            `
                    )
                    .join("")}
            </ol>
        `;
    }

    container.innerHTML =
        html;

    show(container);
}

/* =========================================================
   MATCHING NEWS RESULTS
   ========================================================= */

function renderEvidence(data) {
    const container =
        el("evidenceContainer");

    if (!container) return;

    const live =
        data.live_verification;

    const results =
        live &&
        Array.isArray(
            live.results
        )
            ? live.results
            : [];

    if (
        !results.length
    ) {
        container.innerHTML = `
            <h3>Matching news coverage</h3>

            <p class="tl-empty">
                No current news results matched this story closely enough to count as supporting coverage.
            </p>
        `;

        show(container);
        return;
    }

    const items =
        results
            .map(
                (item) => {
                    const title =
                        escapeHTML(
                            item.title ||
                            "Untitled result"
                        );

                    const source =
                        escapeHTML(
                            item.source ||
                            "Unknown source"
                        );

                    const link =
                        item.link ||
                        item.url ||
                        "";

                    const relevance =
                        item.relevance !== undefined
                            ? ` · ${Math.round(
                                Number(
                                    item.relevance
                                ) * 100
                            )}% word overlap`
                            : "";

                    return `
                        <div class="tl-evidence-item">

                            <strong>
                                ${title}
                            </strong>

                            <div class="tl-evidence-meta">
                                ${source}${relevance}
                            </div>

                            ${
                                link
                                    ? `
                                        <a
                                            class="tl-evidence-link"
                                            href="${escapeHTML(link)}"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            Open article
                                        </a>
                                      `
                                    : ""
                            }

                        </div>
                    `;
                }
            )
            .join("");

    container.innerHTML = `
        <h3>
            Matching news coverage
        </h3>

        <p class="tl-evidence-count">
            ${results.length}
            result${results.length === 1 ? "" : "s"}
            reporting a similar story.
        </p>

        ${items}
    `;

    show(container);
}

/* =========================================================
   CONTRIBUTING WORDS
   ========================================================= */

function renderContributingWords(data) {
    const container =
        el("contributingWords");

    if (!container) return;

    const words =
        data.top_words ||
        data.contributing_words ||
        [];

    if (
        !Array.isArray(words) ||
        !words.length
    ) {
        hide(container);
        return;
    }

    const chips =
        words
            .map(
                (entry) => {
                    const word =
                        escapeHTML(
                            entry.word ||
                            entry.term ||
                            ""
                        );

                    const direction =
                        String(
                            entry.direction ||
                            ""
                        ).toUpperCase();

                    const colour =
                        direction === "REAL"
                            ? "#15803d"
                            : "#b42318";

                    return `
                        <span
                            class="contributing-word"
                            style="color:${colour}"
                        >
                            ${word}
                        </span>
                    `;
                }
            )
            .join("");

    container.innerHTML = `
        <h3>
            Words that pushed the model
        </h3>

        <p>
            Green words pushed the model toward real,
            red words toward fake.
            These come from the model only,
            not from the evidence check.
        </p>

        <div class="tl-word-list">
            ${chips}
        </div>
    `;

    show(container);
}

/* =========================================================
   HISTORY
   ========================================================= */

async function saveResultToHistory(
    data,
    input,
    mode
) {
    try {
        if (
            typeof saveHistoryEntry !==
            "function"
        ) {
            return;
        }

        const prediction =
            normalizePrediction(
                data.prediction
            );

        const confidence =
            Number(
                data.confidence ?? 0
            );

        await saveHistoryEntry(
            String(input || ""),
            prediction,
            confidence
        );

    } catch (error) {
        console.warn(
            "History save failed:",
            error
        );
    }
}

/* =========================================================
   LOADING + ERRORS
   ========================================================= */

function showLoading(
    isLoading
) {
    const loading =
        el("loading");

    if (loading) {
        loading.textContent =
            isLoading
                ? "Analyzing…"
                : "";

        loading.style.display =
            isLoading
                ? "block"
                : "none";
    }

    const checkBtn =
        el("checkBtn");

    const checkImageBtn =
        el("checkImageBtn");

    if (checkBtn) {
        checkBtn.disabled =
            isLoading;
    }

    if (checkImageBtn) {
        checkImageBtn.disabled =
            isLoading;
    }
}

function showError(message) {
    const box =
        el("errorMessage");

    if (!box) {
        alert(message);
        return;
    }

    box.textContent =
        message;

    box.style.display =
        "block";

    box.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });
}

function clearError() {
    const box =
        el("errorMessage");

    if (box) {
        box.textContent =
            "";

        box.style.display =
            "none";
    }
}

/* =========================================================
   CHARACTER COUNT
   ========================================================= */

function updateCharacterCount() {
    const counter =
        el("charCount");

    const input =
        el("articleInput");

    if (
        !counter ||
        !input
    ) {
        return;
    }

    counter.textContent =
        `${input.value.trim().length} characters`;
}

/* =========================================================
   RESPONSE PARSING
   ========================================================= */

async function parseJSONResponse(
    response
) {
    const text =
        await response.text();

    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);

    } catch {
        /*
           The backend sent something that isn't JSON —
           a stack trace or plain-text error page, for example.
        */
        return {
            error: text
        };
    }
}

/* =========================================================
   VALUE HELPERS
   ========================================================= */

function normalizePrediction(
    value
) {
    const text =
        String(
            value || ""
        )
            .trim()
            .toUpperCase();

    if (
        text.includes("FAKE") ||
        text.includes("FALSE")
    ) {
        return "FAKE";
    }

    if (
        text.includes("REAL") ||
        text.includes("TRUE")
    ) {
        return "REAL";
    }

    if (
        text.includes("UNVERIFIED")
    ) {
        return "UNVERIFIED";
    }

    return (
        text ||
        "UNKNOWN"
    );
}

function calculateRiskScore(
    prediction,
    confidence
) {
    const value =
        Number(confidence);

    const safe =
        Number.isFinite(value)
            ? clamp(
                value,
                0,
                100
            )
            : 0;

    if (
        prediction === "FAKE"
    ) {
        return safe;
    }

    if (
        prediction === "REAL"
    ) {
        return 100 - safe;
    }

    return 50;
}

function getRiskLevel(
    score
) {
    if (
        score >= 70
    ) {
        return "high";
    }

    if (
        score >= 40
    ) {
        return "medium";
    }

    return "low";
}

function clamp(
    value,
    min,
    max
) {
    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {
        return min;
    }

    return Math.min(
        Math.max(
            number,
            min
        ),
        max
    );
}

function formatPercent(
    value
) {
    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {
        return "—";
    }

    return `${number.toFixed(1)}%`;
}

function formatScore(
    value
) {
    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {
        return "—";
    }

    return Math.round(number);
}

function capitalise(
    value
) {
    const text =
        String(value || "");

    return (
        text.charAt(0).toUpperCase() +
        text.slice(1)
    );
}

function isValidURL(
    value
) {
    try {
        const url =
            new URL(
                String(value).trim()
            );

        return (
            url.protocol === "http:" ||
            url.protocol === "https:"
        );

    } catch {
        return false;
    }
}

function escapeHTML(
    value
) {
    return String(
        value ?? ""
    )
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}

/* =========================================================
   EXPORTS
   ========================================================= */

window.handleTextVerification =
    handleTextVerification;

window.handleURLVerification =
    handleURLVerification;

window.handleImageVerification =
    handleImageVerification;

window.displayResult =
    displayResult;