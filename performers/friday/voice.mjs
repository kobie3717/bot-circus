import { execFile } from 'child_process';
import { promisify } from 'util';
import { unlink, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Transcribe audio file using local Whisper
 * @param {string} inputPath - Path to input .ogg audio file
 * @returns {Promise<string>} - Transcribed text or error message
 */
export async function transcribe(inputPath) {
  const tempWavPath = inputPath.replace(/\.ogg$/, '.wav');
  const outputDir = '/tmp';
  const baseName = path.basename(inputPath, '.ogg');
  const txtPath = path.join(outputDir, `${baseName}.txt`);

  try {
    // Step 1: Convert .ogg to .wav using ffmpeg (safe: no shell)
    await execFileAsync('ffmpeg', ['-i', inputPath, '-ar', '16000', '-ac', '1', '-y', tempWavPath], {
      timeout: 30000,
    });

    // Step 2: Run Whisper transcription (safe: no shell)
    await execFileAsync('whisper', [tempWavPath, '--model', 'small', '--output_format', 'txt', '--output_dir', outputDir, '--language', 'af'], {
      timeout: 120000,
    });

    // Step 3: Read the resulting .txt file
    if (!existsSync(txtPath)) {
      throw new Error('Transcription file not found');
    }

    const transcription = await readFile(txtPath, 'utf-8');
    const cleanedText = transcription.trim();

    // Step 4: Clean up temp files
    await cleanup(tempWavPath, txtPath);

    return cleanedText || '[Empty transcription]';
  } catch (error) {
    // Clean up on error
    await cleanup(tempWavPath, txtPath);

    return `[Transcription error: ${error.message}]`;
  }
}

/**
 * Clean up temporary files
 * @param {...string} paths - Paths to files to delete
 */
async function cleanup(...paths) {
  for (const filePath of paths) {
    try {
      if (existsSync(filePath)) {
        await unlink(filePath);
      }
    } catch (err) {
      // Ignore cleanup errors
      console.error(`Failed to clean up ${filePath}:`, err.message);
    }
  }
}
