/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from '@google/genai';
import { marked } from 'marked';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// The model 'gemini-2.0-flash-exp' and its config are kept as requested
// Ensure the model used supports multimodal input (like gemini-2.0-flash-exp does)
const chat = ai.chats.create({
  model: 'gemini-2.0-flash-exp', // Confirmed supports TEXT and IMAGE input/output
  config: {
    responseModalities: ['TEXT', 'IMAGE'], // Requesting both text and image output
  },
  history: [], // Keeping history empty for single turn Q&A
});

const userInput = document.querySelector('#input') as HTMLTextAreaElement;
const modelOutput = document.querySelector('#output') as HTMLDivElement;
const slideshow = document.querySelector('#slideshow') as HTMLDivElement;
const error = document.querySelector('#error') as HTMLDivElement;
// New: Get references to the image input and preview elements
const imageInput = document.querySelector('#imageInput') as HTMLInputElement;
const imagePreview = document.querySelector('#imagePreview') as HTMLImageElement;

// New: Variable to hold the uploaded image data (Base64 and MIME type) state
let uploadedImage: { data: string; mimeType: string } | null = null;

// Updated instructions to clarify conditional behavior based on image input
const additionalInstructions = `
Generate an explanation for the user's prompt.

**Core Task:**
- If the user provided an image along with the prompt, **use that specific image as the central theme, reference, or metaphor** to explain the concept in the prompt. The explanation should directly relate to or interpret the provided image in the context of the prompt.s
s
**Output Format Requirements (apply in both cases):**
- Keep sentences short but conversational, casual, and engaging.
- Generate a cute, minimal illustration **for each sentence** with black ink on a white background. This illustration should visually represent the content of that specific sentence (either related to the user's image explanation or the cat metaphor explanation).
- Provide only the explanation and illustrations. No extra commentary before starting or after finishing.
- Continue generating sentence-illustration pairs until the explanation is complete.`;

/**
 * Adds a slide to the slideshow element.
 * @param text The text for the slide's caption.
 * @param image The image element for the slide, or null if none.
 */
async function addSlide(text: string, image: HTMLImageElement | null) {
  // Only add a slide if there's either text or an image provided
  if (!text.trim() && !image) {
     console.warn("Tried to add an empty slide (no text, no image). Skipping.");
     return;
  }

  const slide = document.createElement('div');
  slide.className = 'slide';

  if (image) {
    slide.append(image);
  }

  // Only create and append caption div if there is text
  if (text.trim()) {
      const caption = document.createElement('div'); // HTMLDivElement is the default
      // Use marked.parse to handle markdown in text chunks
      caption.innerHTML = await marked.parse(text);
      slide.append(caption);
  }

  slideshow.append(slide);
  // Ensure the slideshow container is visible after adding the first slide
  slideshow.removeAttribute('hidden');
}

/**
 * Attempts to parse an error response string, extracting a message if possible.
 * @param error The error object or string.
 * @returns A user-friendly error message.
 */
function parseError(error: any): string {
  console.error("Raw Error:", error); // Log the full error for debugging

  if (typeof error === 'string') {
    // Attempt to parse error string if it looks like JSON containing an "error" object
    // Regex looks for {"error": {...}} and captures the inner object
    const regex = /{"error"\s*:\s*({.*?})}/s; // Use lazy match .*? and /s flag
    const match = regex.exec(error);
    if (match && match[1]) {
      try {
        const errorObj = JSON.parse(match[1]);
        // Return the message from the parsed error object, or the original string if parsing fails
        return errorObj.message || error;
      } catch (e) {
        // If JSON parsing of the error object fails, return the original string
        console.error("Failed to parse inner error JSON:", e);
        return error;
      }
    }
    // If the string doesn't match the expected JSON structure, return the original string
    return error;
  }

  // If the error is an object, return its message property or string representation
  return error.message || String(error);
}


/**
 * Generates an explanation based on the user's prompt and optional image.
 * Processes the streamed response to build a slideshow of text and illustrations.
 * @param message The text prompt from the user.
 */
async function generate(message: string) {
  // Clear any previous error message
  error.innerHTML = '';
  error.toggleAttribute('hidden', true);

  // Disable input fields to prevent multiple submissions
  userInput.disabled = true;
  imageInput.disabled = true;

  // Clear previous output before starting
  modelOutput.innerHTML = '';
  slideshow.innerHTML = '';
  slideshow.toggleAttribute('hidden', true); // Hide slideshow container until content is added

  // Capture the uploaded image data for the current request payload
  // We use a temporary variable because we clear the global state immediately after.
  const currentUploadedImage = uploadedImage;

  // **Clear the uploaded image state and preview NOW**
  // This updates the UI immediately and prepares for the next user interaction.
  uploadedImage = null; // Reset the stored data
  if(imageInput) imageInput.value = ''; // Clear the file input's selected file display
  if(imagePreview) {
      imagePreview.style.display = 'none'; // Hide the preview image
      imagePreview.src = ''; // Clear the preview image source
  }


  try {
    // --- Display User's Turn ---
    const userTurn = document.createElement('div');
    let userContentHTML = `<p><strong>You:</strong> ${await marked.parse(message)}</p>`; // Display text prompt, parsing markdown

    // If an image was captured for this turn, display a small preview in the user's turn block
    if (currentUploadedImage) { // Use the captured variable
        const userImagePreview = document.createElement('img');
        userImagePreview.src = `data:${currentUploadedImage.mimeType};base64,${currentUploadedImage.data}`; // Reconstruct Data URL
        userImagePreview.alt = "Uploaded image";
        // CSS class .user-turn img handles styling (max-width, margin, etc.)
        userContentHTML += `<p><strong>Image:</strong></p>${userImagePreview.outerHTML}`; // Add image HTML below text
    }
    userTurn.innerHTML = userContentHTML;
    userTurn.className = 'user-turn';
    modelOutput.append(userTurn);
    // Clear the main input textarea value *after* using it
    userInput.value = '';


    // --- Construct API Payload ---
    // The message is an array of parts, including text and/or inlineData (image)
    const messageParts: ({ text: string } | { inlineData: { data: string; mimeType: string } })[] = [];

    // Add the main text message part
    messageParts.push({ text: message });

    // Add the captured image data if it exists for this turn
    if (currentUploadedImage) { // Use the captured variable
      messageParts.push({
        inlineData: {
          data: currentUploadedImage.data,
          mimeType: currentUploadedImage.mimeType,
        },
      });
    }

    // Add the additional instructions as the final text part.
    // The model should process the user's prompt and image (if any) first,
    // then apply these instructions regarding the explanation style and output format.
    messageParts.push({ text: additionalInstructions });


    // --- Send Message Stream ---
    const result = await chat.sendMessageStream({
      message: messageParts,
    });

    // --- Process Streamed Response ---
    // We expect pairs of text and image parts.
    // Accumulate text until an image is received, then create a slide.
    let currentText = '';

    for await (const chunk of result) {
        console.log("Received chunk:", chunk); // Log chunks for debugging

      for (const candidate of chunk.candidates) {
        for (const part of candidate.content.parts ?? []) {
            console.log("Received part:", part); // Log parts for debugging

          if (part.text) {
            // Accumulate text parts
            currentText += part.text;
            // We *don't* add a slide here yet, because the image for this text
            // is expected in a *subsequent* part/chunk.
            // The slide is added when the corresponding image arrives.

          } else if (part.inlineData) {
            // Received an image. This image should illustrate the 'currentText' accumulated *before* it.
            const imgElement = document.createElement('img');
            // The model is instructed to generate PNG, so assume image/png for display
            imgElement.src = `data:image/png;base64,` + part.inlineData.data;
            imgElement.alt = "Generated Illustration";


            // Add the slide using the text accumulated so far and this new image.
            // The addSlide function handles cases where currentText might be empty.
            await addSlide(currentText, imgElement);

            // Reset text accumulation for the *next* slide
            currentText = '';

          } else {
            console.warn('Received unknown or unexpected part type:', part);
          }
        }
      }
    }

    // --- Handle Remaining Text ---
    // After the stream finishes, 'currentText' might contain text parts
    // that were not followed by an image (e.g., the very last part was text).
    // We should display this remaining text somehow. Appending to the last slide
    // is a reasonable fallback if slides were generated.
    if (currentText.trim()) {
        console.log("Stream ended with remaining text:", currentText);
        const lastSlide = slideshow.lastElementChild as HTMLDivElement;

        if (lastSlide) {
            // Append remaining text to the caption of the last slide
            const captionDiv = lastSlide.querySelector('div');
            if (captionDiv) {
                 // Add a line break before appending the new text
                 captionDiv.innerHTML += "<br>" + await marked.parse(currentText);
            } else {
                 // If the last slide didn't have a caption (e.g., was just an image), create one
                 const newCaptionDiv = document.createElement('div');
                 newCaptionDiv.innerHTML = await marked.parse(currentText);
                 lastSlide.append(newCaptionDiv);
            }
             // Ensure slideshow is visible in case this was the first content received
             slideshow.removeAttribute('hidden');
        } else {
            // If no slides were generated at all (which is unexpected based on instructions
            // but could happen with unexpected model output or errors), display text as a block.
            console.warn("No slides generated, outputting remaining text as block.");
            const textOutput = document.createElement('div');
            // Maybe indicate this text wasn't illustrated?
            textOutput.innerHTML = `<p><strong>Explanation:</strong></p>` + await marked.parse(currentText);
            modelOutput.append(textOutput);
        }
        // Clear remaining text after handling it
        currentText = '';
    }


  } catch (e) {
    // Display error message if anything goes wrong during the process
    const msg = parseError(e);
    error.innerHTML = `Something went wrong: ${msg}`;
    error.removeAttribute('hidden');
    // console.error("Full Error logged by parseError"); // Already logged by parseError
  } finally {
    // Always re-enable input fields after the generation attempt finishes
    userInput.disabled = false;
    imageInput.disabled = false;
    userInput.focus(); // Put cursor back in the text area

    // The uploaded image state and preview are now cleared earlier,
    // after the data was used for messageParts but before the stream processing.
    // This ensures the image input is ready for the next upload immediately.
  }
}

// --- Event Listeners ---

// Event listener for the image input: Reads selected file and updates preview.
imageInput.addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]; // Get the first selected file
  if (file && file.type.startsWith('image/')) { // Check if a file is selected and it's an image
    const reader = new FileReader(); // Create a FileReader to read file content

    reader.onloadend = () => {
      // This runs when the file reading is complete. reader.result is the Base64 string.
      const base64String = reader.result as string; // Get the Base64 string

      // The Data URL format is "data:<mimeType>;base64,<data>"
      const parts = base64String.split(',');
      if (parts.length === 2) {
        // Store the extracted Base64 data part and MIME type in the global state
        uploadedImage = {
          mimeType: parts[0].split(':')[1].split(';')[0], // Extract MIME type (e.g., "image/png")
          data: parts[1], // Extract the Base64 data itself
        };
        // Set the preview image source (uses the full Data URL) and make it visible
        if (imagePreview) { // Added null check
             imagePreview.src = base64String;
             imagePreview.style.display = 'block';
        }
        // Optional: Focus text input after image upload
        userInput.focus();
      } else {
        // Handle unexpected Data URL format
        console.error("Failed to parse base64 data from FileReader result.");
        // Reset state and preview if parsing fails
        uploadedImage = null;
        if(imagePreview) { imagePreview.style.display = 'none'; imagePreview.src = ''; }
        if(imageInput) imageInput.value = ''; // Clear the file input display
      }
    };

    reader.onerror = (err) => {
        console.error("FileReader error:", err);
        // Reset state and preview on error
        uploadedImage = null;
        if(imagePreview) { imagePreview.style.display = 'none'; imagePreview.src = ''; }
        if(imageInput) imageInput.value = ''; // Clear the file input display
         // Optional: Display an error message to the user
         // error.innerHTML = `Error reading image file: ${err.message || String(err)}`;
         // error.removeAttribute('hidden');
    };

    // Read the file content as a Data URL (Base64 string)
    reader.readAsDataURL(file);

  } else {
    // If no file is selected or it's not an image, clear the state and preview
    uploadedImage = null;
    if(imagePreview) { imagePreview.style.display = 'none'; imagePreview.src = ''; }
    if(imageInput) imageInput.value = ''; // Clear the file input display
  }
});


// Event listener for the textarea (Enter key): Trigger generation on Enter (without Shift)
userInput.addEventListener('keydown', async (e: KeyboardEvent) => {
  // Check if the pressed key is Enter and Shift key is NOT held down
  if (e.key === 'Enter' && !e.shiftKey && !userInput.disabled) { // Check if input is not disabled
    e.preventDefault(); // Prevent the default Enter key behavior (new line)

    const message = userInput.value.trim(); // Get the trimmed value of the textarea

    // Only trigger generation if there is text OR an uploaded image
    if (message || uploadedImage) {
       await generate(message);
    } else {
       // If both are empty, maybe provide some user feedback (optional)
       console.log("Please enter a prompt or upload an image to start.");
       // Could add a temporary visual cue here
    }
  }
});

// Event listeners for example prompts: Trigger generation on click
const examples = document.querySelectorAll('#examples li');
examples.forEach((li) =>
  li.addEventListener('click', async (e) => {
    // Prevent triggering if another request is in progress
    if (!userInput.disabled) {
       const message = li.textContent?.trim() || ''; // Get the example text, trim whitespace

       // Although examples don't have images, we still check uploadedImage
       // in case the user clicked an example *after* uploading an image.
       if (message || uploadedImage) {
            await generate(message);
       } else {
            // This case happens if user clicks an empty example and no image is uploaded
            console.log("Please enter a prompt or upload an image.");
       }
    }
  }),
);