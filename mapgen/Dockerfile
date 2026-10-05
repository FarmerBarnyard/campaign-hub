# Map generation service.
#
# The fonts are the reason this is a real image rather than a bare `node`
# container. The generators name Georgia / Palatino Linotype / Book Antiqua,
# none of which exist on Linux; without metric-compatible faces installed and
# aliased, measureText returns different widths and every label on every map
# shifts -- silently, with no error and no visual tell short of comparing two
# exports side by side. Pinning them in the image is what makes a render
# reproducible.
FROM node:22-bookworm-slim

# fonts-urw-base35 provides P052 (URW's Palatino clone -- the second family in
# the generators' own font stack, so it is the intended look rather than a
# substitution). fonts-dejavu-core covers the sans-serif labels.
# Both come from Debian, so the image builds without reaching out to a font CDN.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      fonts-urw-base35 \
      fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/mapgen

# Dependencies first, so edits to generator source don't re-run npm install.
COPY mapgen/package.json mapgen/package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# The service loads the browser generators as-is (see src/load-generators.js),
# so lib/ and views/ ship alongside it -- one implementation of the art, shared
# with the browser, rather than a server-side copy that can drift.
COPY lib/ /app/lib/
COPY views/ /app/views/
COPY mapgen/src/ ./src/
COPY mapgen/fonts/ ./fonts/

# Copy the Debian faces into the app's own font dir, where fonts.json maps each
# one to the family names the generators ask for.
RUN cp /usr/share/fonts/opentype/urw-base35/P052-Roman.otf \
       /usr/share/fonts/opentype/urw-base35/P052-Bold.otf \
       /usr/share/fonts/opentype/urw-base35/P052-Italic.otf \
       /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
       /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf \
       ./fonts/

# Fail the build rather than the first render: a missing family throws from
# createGeneratorContext, so this turns a silent typographic regression into a
# broken build that cannot be deployed.
RUN node -e "require('./src/load-generators').createGeneratorContext({fontDir:'./fonts'}); console.log('font check ok')"

# 0.0.0.0 here means "all interfaces of this container's own network
# namespace", NOT the VM's LAN -- binding 127.0.0.1 inside a container makes
# the port unreachable through Docker's port publishing, since the forwarder
# connects from outside the namespace. The loopback restriction that actually
# matters is on the host side, where compose publishes this as
# "127.0.0.1:8791:8791" (the same shape the Ollama service on this host uses).
# Changing that publish to a bare "8791:8791" is what would expose it.
ENV MAPGEN_HOST=0.0.0.0
ENV MAPGEN_PORT=8791
EXPOSE 8791

USER node
CMD ["node", "src/server.js"]
