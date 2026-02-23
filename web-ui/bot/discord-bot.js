import "dotenv/config";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, MessageFlags, EmbedBuilder } from "discord.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const apiBaseUrl = process.env.API_BASE_URL || "http://127.0.0.1:3000";
const themeGold = 0xbc9148;
const REQUEST_TIMEOUT_MS = Number(process.env.BOT_REQUEST_TIMEOUT_MS || 8000);
const EMBED_THUMBNAIL_URL = process.env.EMBED_THUMBNAIL_URL || "https://via.placeholder.com/192x192.png?text=Tibia";
const EMBED_BANNER_URL = process.env.EMBED_BANNER_URL || "https://via.placeholder.com/800x200.png?text=Alt+Tracker";

if (!token || !clientId || !guildId) {
  console.error("Missing DISCORD_TOKEN / DISCORD_CLIENT_ID / DISCORD_GUILD_ID in environment.");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("alt")
    .setDescription("Find likely hidden alts (best combined mode)")
    .addStringOption((option) => option
      .setName("character")
      .setDescription("Character name")
      .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("alt-strict")
    .setDescription("Find likely hidden alts (strict mode)")
    .addStringOption((option) => option
      .setName("character")
      .setDescription("Character name")
      .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("alt-relaxed")
    .setDescription("Find likely hidden alts (relaxed mode)")
    .addStringOption((option) => option
      .setName("character")
      .setDescription("Character name")
      .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("guild")
    .setDescription("Lookup guild members")
    .addStringOption((option) => option
      .setName("name")
      .setDescription("Guild name")
      .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("traded-when")
    .setDescription("Show when a character was last traded/transferred")
    .addStringOption((option) => option
      .setName("character")
      .setDescription("Character name")
      .setRequired(true)
    )
].map((cmd) => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log("Slash commands registered.");
}

function formatConfidenceLabel(value) {
  const label = String(value || "low").toLowerCase();
  if (label === "high") return "HIGH";
  if (label === "medium") return "MEDIUM";
  return "LOW";
}

function vocationEmoji(vocation) {
  const v = String(vocation || "").toLowerCase();
  if (v.includes("elite knight") || v === "knight") return "🛡️";
  if (v.includes("royal paladin") || v === "paladin") return "🏹";
  if (v.includes("elder druid") || v === "druid") return "❄️";
  if (v.includes("master sorcerer") || v === "sorcerer") return "🔥";
  if (v.includes("monk")) return "☯️";
  return "";
}

function themedEmbed(title) {
  return new EmbedBuilder()
    .setColor(themeGold)
    .setTitle(title)
    .setThumbnail(EMBED_THUMBNAIL_URL)
    .setImage(EMBED_BANNER_URL)
    .setFooter({ text: "Online tracker" })
    .setTimestamp();
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await interaction.deferReply();

    if (interaction.commandName === "alt" || interaction.commandName === "alt-strict" || interaction.commandName === "alt-relaxed") {
      const character = interaction.options.getString("character", true);
      const mode = interaction.commandName === "alt-strict"
        ? "strict"
        : interaction.commandName === "alt-relaxed"
          ? "relaxed"
          : "best";

      const { ok, data } = await fetchJson(`${apiBaseUrl}/api/search/alt?q=${encodeURIComponent(character)}&mode=${mode}`);
      if (!ok) {
        await interaction.editReply("API request failed. Make sure the web server is running.");
        return;
      }

      if (!data.found || !data.candidates.length) {
        const embed = themedEmbed("Alt Finder")
          .setDescription(`Searched characters: ${character.toLowerCase()}`)
          .addFields(
            { name: "Mode", value: "best", inline: true },
            { name: "Date Filter", value: "beginning -> now", inline: true },
            { name: "Possible Matches", value: "No matches found." }
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const loginSegments = Number(data?.tracker?.seedLoginSegments || 0);
      const modeLabel = mode === "strict" ? "strict" : mode === "relaxed" ? "relaxed" : "best";
      const summaryLines = [
        `Seed: ${String(data?.seed?.name || character)}`,
        `Mode: ${modeLabel}`,
        `World: ${String(data?.seed?.world || "unknown")}`,
        `Tracked Logins: ${loginSegments}`,
        `Window: ${Math.round(Number(data?.tracker?.windowSeconds || 0) / 60)} min`,
        `Min Pairs: ${String(data?.tracker?.minPairs || 0)}`,
        `Clash Filter: ${String(Boolean(data?.tracker?.includeClashes || false))}`
      ];

      const embed = themedEmbed("Alt Finder")
        .setDescription([
          "**Alt & Trade Intelligence**",
          "Hidden alts, guild signals, and trade windows.",
          "",
          summaryLines.join(" | ")
        ].join("\n"));

      const top = data.candidates.slice(0, 5);
      for (const c of top) {
        const emoji = vocationEmoji(c.vocation);
        const title = `${emoji ? `${emoji} ` : ""}${c.name} (${c.world || "?"})`;
        const confidence = `${c.confidence ?? 0}% ${formatConfidenceLabel(c.confidenceLabel)}`;
        const transitions = Array.isArray(c.transitions) && c.transitions.length
          ? c.transitions.map((t) => `${t.deltaSeconds ?? 0}s`).slice(0, 5).join(", ")
          : "none";
        const lines = [
          `Confidence: ${confidence}`,
          `Adjacencies: ${c.adjacencies ?? 0} | Clashes: ${c.clashes ?? 0} | Logins: ${c.logins ?? 0}`,
          `Reasons: ${(c.reasons || []).join(", ") || "none"}`,
          `Transitions: ${transitions}`,
          `Source: ${c.source || "unknown"}`
        ];
        embed.addFields({ name: title, value: lines.join("\n") });
      }

      if (loginSegments < 10) {
        embed.addFields({
          name: "Minimum Data Warning",
          value: `Only ${loginSegments} login segment(s) collected. Recommended minimum: 10+ for reliable alt detection.`
        });
      }

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (interaction.commandName === "guild") {
      const name = interaction.options.getString("name", true);
      const { ok, data } = await fetchJson(`${apiBaseUrl}/api/search/guild?q=${encodeURIComponent(name)}`);
      if (!ok) {
        await interaction.editReply("API request failed. Make sure the web server is running.");
        return;
      }

      if (!data.members.length) {
        const embed = themedEmbed("Guild Search")
          .setDescription(`No guild members found for **${name}**.`);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const preview = data.members.slice(0, 10)
        .map((m) => `${m.name} - ${m.level} ${m.vocation}`)
        .join("\n");

      const embed = themedEmbed(`Guild: ${name}`)
        .setDescription(`Members found: **${data.count}**`)
        .addFields({ name: "Top Members", value: `\`\`\`\n${preview}\n\`\`\`` });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (interaction.commandName === "traded-when") {
      const character = interaction.options.getString("character", true);
      const { ok, data } = await fetchJson(`${apiBaseUrl}/api/search/traded?character=${encodeURIComponent(character)}`);
      if (!ok) {
        await interaction.editReply("API request failed. Make sure the web server is running.");
        return;
      }

      if (!data.found) {
        const embed = themedEmbed("Trade/Transfer Search")
          .setDescription(`No trade/transfer record found for **${character}**.`);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const trade = data.lastTradedAt || "N/A";
      const transfer = data.lastTransferredAt || "N/A";
      const embed = themedEmbed(`Trade Info: ${data.character.name}`)
        .addFields(
          { name: "Last Traded", value: String(trade), inline: true },
          { name: "Last Transferred", value: String(transfer), inline: true },
          { name: "Source", value: String(data?.character?.source || "unknown"), inline: true }
        );

      await interaction.editReply({ embeds: [embed] });
    }
  } catch (error) {
    console.error(`Request to ${apiBaseUrl} failed`, error);
    const isAbort = error?.name === "AbortError";
    const message = isAbort
      ? "Request timed out. The API may be busy—try again in a moment."
      : "Request failed.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
      return;
    }
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  }
});

registerCommands()
  .then(() => client.login(token))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
