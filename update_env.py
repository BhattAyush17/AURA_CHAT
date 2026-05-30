with open(".env.local", "r") as f:
    content = f.read()

# Add VITE_ prefixed keys for frontend
lines = content.split("\n")
new_lines = []
for line in lines:
    new_lines.append(line)
    if line.startswith("SARVAM_API_KEY="):
        new_lines.append("VITE_" + line)
    elif line.startswith("OPENROUTER_API_KEY="):
        new_lines.append("VITE_" + line)
    elif line.startswith("COHERE_API_KEY="):
        new_lines.append("VITE_" + line)

with open(".env.local", "w") as f:
    f.write("\n".join(new_lines))
