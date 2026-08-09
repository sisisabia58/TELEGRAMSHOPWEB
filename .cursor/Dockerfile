FROM node:20-bookworm

########################################################
# Docker (required for `supabase start` local stack)
########################################################

RUN install -m 0755 -d /etc/apt/keyrings && \
    curl --retry 3 --retry-delay 5 -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
    apt-get update && \
    apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin \
    fuse-overlayfs \
    iptables \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /etc/docker && \
    printf '%s\n' '{' \
    '  "storage-driver": "fuse-overlayfs"' \
    '}' > /etc/docker/daemon.json

RUN update-alternatives --set iptables /usr/sbin/iptables-legacy && \
    update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy

########################################################
# Railway CLI + Supabase CLI
########################################################

RUN curl --retry 3 --retry-delay 5 -fsSL https://railway.com/install.sh | sh

RUN curl --retry 3 --retry-delay 5 -fsSL \
    "https://github.com/supabase/cli/releases/latest/download/supabase_linux_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" \
    | tar -xz -C /usr/local/bin supabase

########################################################
# Non-root user (Cursor Cloud default)
########################################################

RUN id -u ubuntu &>/dev/null || useradd -m -s /bin/bash ubuntu
RUN groupadd -f docker && usermod -aG docker ubuntu
RUN usermod -aG sudo ubuntu
RUN echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu

WORKDIR /workspace
