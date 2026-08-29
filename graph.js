class GraphEngine {
    constructor(db) {
        this.db = db;
    }

    formatHour(h) {
        if (h === 0) return '12 AM';
        if (h < 12) return `${h} AM`;
        if (h === 12) return '12 PM';
        return `${h - 12} PM`;
    }

    getColorForValue(v) {
        const colors = { 1: '#FF4D55', 2: '#FF914D', 3: '#FFD84D', 4: '#FFB52E', 5: '#20E879' };
        return colors[Math.round(v)] || 'var(--accent)';
    }

    // Unified Aggregator: Forces the passed 'type' (Day, Week, Month, Year) across ANY start/end range!
    getAggregatedData(type, start, end) {
        let buckets = [];
        let curr = new Date(start);
        
        if (type === 'Day') {
            // Hourly blocks
            while (curr <= end) {
                for (let h=0; h<24; h++) {
                    const val = this.db.dayData(curr)[h] || 0;
                    buckets.push({
                        label: `${curr.toLocaleDateString('en-US',{month:'short', day:'numeric'})} ${this.formatHour(h)}`,
                        shortLabel: (h === 12 ? curr.toLocaleDateString('en-US',{weekday:'short'}) : ''),
                        value: val
                    });
                }
                curr.setDate(curr.getDate() + 1);
            }
            return { points: buckets, chartType: 'line' };
        } 
        
        if (type === 'Week' || type === 'Month') {
            // Daily blocks
            while(curr <= end) {
                const dayMap = this.db.dayData(curr);
                const vals = Object.values(dayMap).filter(v=>typeof v==='number');
                const avg = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
                
                let sLabel = type === 'Week' 
                    ? curr.toLocaleDateString('en-US',{weekday:'short'})[0] 
                    : curr.getDate().toString(); 
                    
                buckets.push({ 
                    label: curr.toLocaleDateString('en-US',{weekday:'short', month:'short', day:'numeric'}), 
                    shortLabel: sLabel, 
                    value: avg 
                });
                curr.setDate(curr.getDate() + 1);
            }
            return { points: buckets, chartType: 'bar' };
        }
        
        if (type === 'Year') {
            // Monthly blocks
            curr.setDate(1); 
            while (curr <= end) {
                let monthEnd = new Date(curr.getFullYear(), curr.getMonth() + 1, 0);
                let actualEnd = monthEnd < end ? monthEnd : end;
                let mCurr = new Date(curr);
                let vals = [];
                while(mCurr <= actualEnd) {
                    const dayMap = this.db.dayData(mCurr);
                    vals.push(...Object.values(dayMap).filter(v=>typeof v==='number'));
                    mCurr.setDate(mCurr.getDate()+1);
                }
                const avg = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
                buckets.push({ 
                    label: curr.toLocaleDateString('en-US', {month:'long', year:'numeric'}), 
                    shortLabel: curr.toLocaleDateString('en-US', {month:'short'}), 
                    value: avg 
                });
                curr.setMonth(curr.getMonth() + 1);
            }
            return { points: buckets, chartType: 'bar' };
        }
    }

    calculateStats(dataPoints) {
        const valid = dataPoints.filter(d => d.value > 0);
        if(!valid.length) return { peak: '--', average: '--', lowest: '--', avgVal: 0 };

        const max = Math.max(...valid.map(d => d.value));
        const min = Math.min(...valid.map(d => d.value));
        const sum = valid.reduce((a, b) => a + b.value, 0);
        const avg = (sum / valid.length).toFixed(1);

        const formatVal = (val) => Number.isInteger(val) ? val : val.toFixed(1);

        const groupConsecutive = (targetValue) => {
            let ranges = [];
            let currentRange = [];
            
            for (let i = 0; i < dataPoints.length; i++) {
                if (dataPoints[i].value === targetValue) {
                    currentRange.push(i);
                } else {
                    if (currentRange.length > 0) {
                        ranges.push(currentRange);
                        currentRange = [];
                    }
                }
            }
            if (currentRange.length > 0) {
                ranges.push(currentRange);
            }

            return ranges.map(range => {
                if (range.length === 1) {
                    return dataPoints[range[0]].label;
                } else {
                    return `${dataPoints[range[0]].label} – ${dataPoints[range[range.length - 1]].label}`;
                }
            }).join(', ');
        };

        const peakLabels = groupConsecutive(max);
        const lowLabels = groupConsecutive(min);

        return { 
            peak: `${formatVal(max)}<br><span style="font-size:0.75rem; color:var(--text); display:block; margin-top:6px; font-weight:500; white-space:normal; line-height:1.4;">${peakLabels}</span>`, 
            average: avg, 
            lowest: `${formatVal(min)}<br><span style="font-size:0.75rem; color:var(--text); display:block; margin-top:6px; font-weight:500; white-space:normal; line-height:1.4;">${lowLabels}</span>`,
            avgVal: parseFloat(avg) 
        };
    }

    renderGraph(containerId, dataPoints, chartType, avgValue) {
        const container = document.getElementById(containerId);
        if(!container) return;

        if(dataPoints.filter(d => d.value > 0).length === 0) {
            container.innerHTML = `<div class="empty-graph">No data for this period</div>`;
            return;
        }

        const width = 400; 
        const height = 180;
        const padLeft = 32;  
        const padRight = 16;
        const padY = 24;
        
        const graphW = width - padLeft - padRight;
        const graphH = height - padY * 2;

        let svg = `<svg viewBox="0 0 ${width} ${height}" style="width:100%; height:100%; overflow:visible;">`;

        for(let v = 1; v <= 5; v++) {
            const y = padY + graphH - (v / 5) * graphH;
            svg += `<text x="${padLeft - 8}" y="${y + 3}" fill="var(--muted)" font-size="10" text-anchor="end">${v}</text>`;
            svg += `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="var(--border)" stroke-width="0.5" />`;
        }
        
        svg += `<text x="${padLeft - 8}" y="${padY + graphH + 3}" fill="var(--muted)" font-size="10" text-anchor="end">0</text>`;
        svg += `<line x1="${padLeft}" y1="${padY + graphH}" x2="${width - padRight}" y2="${padY + graphH}" stroke="var(--border)" stroke-width="1" />`;

        if(avgValue > 0) {
            const avgY = padY + graphH - (avgValue / 5) * graphH;
            svg += `<line x1="${padLeft}" y1="${avgY}" x2="${width-padRight}" y2="${avgY}" stroke="var(--accent)" stroke-dasharray="4 4" stroke-width="1" opacity="0.6" />`;
        }

        if(chartType === 'line') {
            let pts = [];
            dataPoints.forEach((d, i) => {
                const x = padLeft + (i / (dataPoints.length - 1)) * graphW;
                
                // SKIPS ZEROES ENTIRELY SO THE LINE DOESN'T PLUMMET!
                if(d.value > 0) {
                    const y = padY + graphH - (d.value / 5) * graphH;
                    pts.push(`${x},${y}`);
                }
                
                if(d.shortLabel) {
                    svg += `<text x="${x}" y="${height - 4}" fill="var(--muted)" font-size="10" text-anchor="middle">${d.shortLabel}</text>`;
                }
            });
            
            if(pts.length > 0) {
                let firstX = pts[0].split(',')[0];
                let lastX = pts[pts.length-1].split(',')[0];
                svg += `<polygon points="${firstX},${padY+graphH} ${pts.join(' ')} ${lastX},${padY+graphH}" fill="rgba(56, 189, 248, 0.15)" />`;
                svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" />`;
            }
            
            dataPoints.forEach((d, i) => {
                if(d.value > 0) {
                    const x = padLeft + (i / (dataPoints.length - 1)) * graphW;
                    const y = padY + graphH - (d.value / 5) * graphH;
                    svg += `<circle cx="${x}" cy="${y}" r="5" fill="var(--bg)" stroke="var(--accent)" stroke-width="2.5" class="graph-pt" data-label="${d.label}" data-val="${d.value}" />`;
                }
            });
        } else {
            const maxBarW = 28;
            const step = graphW / dataPoints.length;
            const barW = Math.min(step * 0.75, maxBarW); 
            
            dataPoints.forEach((d, i) => {
                const x = padLeft + (i * step) + (step / 2) - (barW / 2);
                const h = (d.value / 5) * graphH;
                const y = padY + graphH - h;
                const color = this.getColorForValue(d.value);
                
                if(d.value > 0) {
                    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" rx="3" class="graph-pt" data-label="${d.label}" data-val="${d.value}" />`;
                }
                
                if (dataPoints.length <= 14 || i % Math.ceil(dataPoints.length/7) === 0) {
                   svg += `<text x="${x + barW/2}" y="${height - 4}" fill="var(--muted)" font-size="10" text-anchor="middle">${d.shortLabel}</text>`;
                }
            });
        }

        svg += `</svg><div id="graphTooltip" class="graph-tooltip"></div>`;
        container.innerHTML = svg;

        const tooltip = container.querySelector('#graphTooltip');
        container.querySelectorAll('.graph-pt').forEach(pt => {
            const showTooltip = (e) => {
                const label = pt.getAttribute('data-label');
                const val = parseFloat(pt.getAttribute('data-val')).toFixed(1).replace('.0', '');
                tooltip.innerHTML = `<strong>${label}</strong><br><span style="color:var(--muted)">Mental Energy: ${val}</span>`;
                
                const rect = pt.getBoundingClientRect();
                const contRect = container.getBoundingClientRect();
                const left = rect.left - contRect.left + (rect.width / 2);
                const top = rect.top - contRect.top;
                
                tooltip.style.left = `${left}px`;
                tooltip.style.top = `${top}px`;
                tooltip.style.opacity = 1;
            };
            
            pt.addEventListener('touchstart', showTooltip, {passive: true});
            pt.addEventListener('mouseenter', showTooltip);
            pt.addEventListener('mouseleave', () => tooltip.style.opacity = 0);
        });
    }
}
